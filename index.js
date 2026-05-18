// index.js
require("dotenv").config(); // โหลดค่าจาก .env บนสุด
const express = require("express");
const line = require("@line/bot-sdk");
const { createClient } = require("@supabase/supabase-js");
const { GoogleGenAI } = require("@google/genai");

const app = express();
const PORT = process.env.PORT || 3002; 

// 1. ตั้งค่า LINE Developers Console ข้อมูลผ่าน .env
const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

// 2. ประกาศตัวแปร LINE Clients ไว้ด้านบนสุด
const client = new line.messagingApi.MessagingApiClient({
  channelAccessToken: config.channelAccessToken,
});

const blobClient = new line.messagingApi.MessagingApiBlobClient({
  channelAccessToken: config.channelAccessToken,
});

// 3. กำหนดค่า Gemini และ Supabase Client
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// Middleware สำหรับมอนิเตอร์ดู Log การยิง Request เข้าเซิร์ฟเวอร์
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// หน้าแรกตรวจสอบเซิร์ฟเวอร์ (ระบุชื่อของคุณ Thanakrit)
app.get("/", (req, res) => {
  res.send("Hello Teacher, Thanakrit Manaprasertsak (Port 3002)");
});

// 4. LINE Webhook Setup รับค่าที่เส้นทาง /callback ตามโดเมนของคุณ
app.post("/callback", line.middleware(config), (req, res) => {
  // ตอบกลับสถานะ 200 ทันทีตามกฎของ LINE
  res.status(200).end();

  if (req.body && req.body.events) {
    Promise.all(req.body.events.map(handleEvent))
      .then((result) => console.log("Handle event success:", result))
      .catch((err) => {
        console.error("Error handling webhook event:", err);
      });
  }
});

// 5. ฟังก์ชันหลักในการจัดการ Event และบันทึกข้อมูล (ปรับปรุงตามสไลด์อาจารย์)
async function handleEvent(event) {
  // รองรับเฉพาะ Event ประเภทข้อความ (Message Event) เท่านั้น
  if (event.type !== 'message') {
    return null;
  }

  const userId = event.source.userId || 'unknown';
  const replyToken = event.replyToken || '';
  const messageId = event.message.id;
  const messageType = event.message.type; // text, image, sticker, video, etc.
 
  let content = null;
  let botReplyText = '';

  // กรณีที่ 1: ตรวจสอบหากเป็น "ข้อความตัวอักษร" -> ใช้เขียนตามสไลด์อาจารย์เป๊ะๆ
  if (event.message.type === 'text') {
    content = event.message.text;
    
    try {
      // 🟢 ปรับตามสไลด์หน้า 44 ของอาจารย์เรียบร้อยครับ
      const geminiResponse = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: content,
      });
      botReplyText = geminiResponse.text || 'ขออภัยครับ ระบบไม่สามารถสร้างคำตอบได้';
      
    } catch (err) {
      console.error("Gemini Error:", err);
      botReplyText = "ขออภัย เกิดข้อผิดพลาดในการเชื่อมต่อกับ Gemini ครับ";
    }

  // กรณีที่ 2: ตรวจสอบหากเป็น "รูปภาพ" -> ส่งให้ Gemini วิเคราะห์สัตว์ + อัปโหลดลง Supabase
  } else if (event.message.type === 'image') {
    try {
      // แจ้งเตือนรอบแรกว่ารับรูปแล้ว
      await client.replyMessage({
        replyToken: replyToken,
        messages: [{ type: 'text', text: 'ส่งรูปภาพสำเร็จ รอสักครู่นะครับกำลังประมวลผล...' }]
      });

      // 1. ดาวน์โหลดรูปภาพจาก LINE
      const stream = await blobClient.getMessageContent(messageId);
      const chunks = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }
      const buffer = Buffer.concat(chunks);

      // 2. ส่งรูปให้ Gemini วิเคราะห์สายพันธุ์สัตว์ (ใช้ตัวแปร geminiResponse ตามสไตล์อาจารย์)
      const geminiResponse = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [
          { text: "รูปนี้คือสัตว์ชนิดอะไร ตอบสั้นๆ ถ้าไม่ใช่สัตว์ให้ตอบว่า ไม่ใช่สัตว์" },
          { inlineData: { data: buffer.toString('base64'), mimeType: 'image/jpeg' } }
        ]
      });
      const animalName = geminiResponse.text || 'ไม่สามารถระบุได้';

      // 3. อัปโหลดรูปภาพลง Supabase Bucket ชื่อ 'uploads'
      const fileName = `${messageId}.jpg`;
      const { data, error: uploadError } = await supabase.storage
        .from('uploads')
        .upload(fileName, buffer, { contentType: 'image/jpeg' });
        
      if (uploadError) {
        console.error('Supabase Upload Error:', uploadError);
      }
      
      const { data: publicUrlData } = supabase.storage.from('uploads').getPublicUrl(fileName);
      const imageUrl = publicUrlData.publicUrl;

      // 4. บันทึกข้อมูลลงตาราง messages ในฐานข้อมูล Supabase
      const { error: dbError } = await supabase.from('messages').insert([
        {
          user_id: userId,
          message_id: messageId,
          type: 'image',
          content: imageUrl,
          reply_token: replyToken,
          reply_content: animalName
        }
      ]);
      if (dbError) {
        console.error('Supabase Insert Error:', dbError);
      }

      // 5. ส่งคำตอบผ่าน Push Message
      return await client.pushMessage({
        to: userId,
        messages: [{ type: 'text', text: `นี่คือ: ${animalName}` }]
      });

    } catch (err) {
      console.error("Image processing error:", err);
      return await client.pushMessage({
        to: userId,
        messages: [{ type: 'text', text: 'ขออภัย เกิดข้อผิดพลาดในการประมวลผลรูปภาพครับ' }]
      });
    }
  } else {
    // หากเป็นประเภทอื่น เช่น sticker, video
    content = `[Received ${messageType} message]`;
    botReplyText = `ได้รับข้อความประเภท ${messageType} แล้วครับ`;
  }

  // 🟢 ส่งข้อมูลเข้าฐานข้อมูล Supabase (ล้อตามโครงสร้างในสไลด์อาจารย์ด้านล่าง)
  try {
    const { error } = await supabase
      .from('messages')
      .insert([
        {
          user_id: userId,
          message_id: messageId,
          type: messageType,
          content: content,
          reply_token: replyToken,
          reply_content: botReplyText // บันทึกคู่คำตอบที่มาจาก Gemini ลงไปด้วย
        }
      ]);

    if (error) {
      console.error('Supabase Insert Error:', error.message);
    }

    // ตอบกลับข้อความหาผู้ใช้ใน LINE
    return await client.replyMessage({
      replyToken: replyToken,
      messages: [{ type: 'text', text: botReplyText }],
    });

  } catch (error) {
    console.error('เกิดข้อผิดพลาดในการประมวลผลระบบ:', error);
  }
}

// 6. Error Handling ระบบความปลอดภัยลายเซ็น LINE
app.use((err, req, res, next) => {
  if (err instanceof line.SignatureValidationFailed) {
    console.error("Signature validation failed:", err.signature);
    res.status(401).send(err.signature);
    return;
  } else if (err instanceof line.JSONParseError) {
    console.error("JSON Parse Error:", err.raw);
    res.status(400).send(err.raw);
    return;
  }
  console.error("Global Error:", err);
  res.status(500).send(err.message);
});

// เริ่มต้นรันเซิร์ฟเวอร์ที่พอร์ต 3002
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});