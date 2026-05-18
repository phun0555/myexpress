// index.js
require("dotenv").config(); 
const express = require("express");
const line = require("@line/bot-sdk");
const { createClient } = require("@supabase/supabase-js");
const { GoogleGenAI } = require("@google/genai");

const app = express();
const PORT = process.env.PORT || 3002; 

// กำหนดการเชื่อมต่อ LINE Platform
const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const client = new line.messagingApi.MessagingApiClient({ channelAccessToken: config.channelAccessToken });
const blobClient = new line.messagingApi.MessagingApiBlobClient({ channelAccessToken: config.channelAccessToken });

// เชื่อมต่อโมเดลคู่หูอย่างเป็นทางการ (Gemini และ Supabase)
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// เส้นทาง Webhook สอดคล้องตามข้อกำหนดหน้า 44 ของอาจารย์
app.use('/webhook', line.middleware(config));

app.post('/webhook', (req, res) => {
  res.status(200).end();
  if (req.body && req.body.events) {
    Promise.all(req.body.events.map(handleEvent))
      .then(() => console.log("LINE Webhook Event Processed Successfully"))
      .catch((err) => console.error("Webhook Error:", err));
  }
});

// 🌟 [จุดแก้ไขหลักบนเซิร์ฟ]: เติมลอจิกคุยกับ Gemini คืนสู่ฟังก์ชัน handleEvent
async function handleEvent(event) {
  if (event.type !== 'message') return null;

  const userId = event.source.userId || 'unknown';
  const replyToken = event.replyToken || '';
  const messageId = event.message.id;
  const messageType = event.message.type;
 
  let content = null;
  let botReplyText = '';

  // 🎯 โจทย์ข้อ 1: รับส่งและประมวลผลข้อความตัวอักษรด้วยโมเดล Gemini
  if (event.message.type === 'text') {
    content = event.message.text; 
    try {
      // เรียกโมเดลตรงตามสไลด์ที่อาจารย์สอนเป๊ะ ๆ
      const geminiResponse = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: content,
      });
      botReplyText = geminiResponse.text || 'ขออภัยครับ ระบบไม่สามารถสร้างคำตอบได้';
    } catch (err) {
      console.error("Gemini Connect Error:", err);
      botReplyText = "ระบบขัดข้อง ไม่สามารถดึงความรู้จาก Gemini ได้ในขณะนี้";
    }

  // 🎯 โจทย์ข้อ 2-3: ดักจับรูปภาพ แจ้งสถานะด่วน และส่งให้ Gemini แกะคัดแยกประเภทสัตว์
  } else if (event.message.type === 'image') {
    try {
      // ตอบกลับผู้ใช้งานทันทีเพื่อบอกสถานะการทำงาน (รับแต้มพิเศษ)
      await client.replyMessage({
        replyToken: replyToken,
        messages: [{ type: 'text', text: 'ส่งรูปภาพสำเร็จ รอสักครู่นะครับกำลังประมวลผล...' }]
      });

      // ดึงสตรีมไฟล์ภาพมาแปลงเป็นรูปแบบ Buffer เพื่อส่งต่อ
      const stream = await blobClient.getMessageContent(messageId);
      const chunks = [];
      for await (const chunk of stream) { chunks.push(chunk); }
      const buffer = Buffer.concat(chunks);

      // ยิงข้อมูลรูปภาพให้ Gemini คัดแยกสายพันธุ์สัตว์
      const geminiResponse = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [
          { text: "รูปนี้คือสัตว์ชนิดอะไร ตอบเป็นภาษาไทยสั้นๆ ถ้าไม่ใช่สัตว์ให้ตอบว่า ไม่ใช่สัตว์" },
          { inlineData: { data: buffer.toString('base64'), mimeType: 'image/jpeg' } }
        ]
      });
      botReplyText = `นี่คือ: ${geminiResponse.text || 'ไม่สามารถระบุได้'}`;

      // บันทึกจัดเก็บรูปภาพเข้าคลังเก็บไฟล์บนระบบ Supabase Storage
      const fileName = `${messageId}.jpg`;
      await supabase.storage.from('uploads').upload(`bot-uploads/${fileName}`, buffer, { contentType: 'image/jpeg', upsert: true });
      const { data: publicUrlData } = supabase.storage.from('uploads').getPublicUrl(`bot-uploads/${fileName}`);
      content = publicUrlData.publicUrl;

      // พ่นผลลัพธ์การคัดแยกสัตว์ตอบแชทกลับหาผู้ใช้
      await client.pushMessage({ to: userId, messages: [{ type: 'text', text: botReplyText }] });
    } catch (err) {
      console.error("Image Processing Failed:", err);
      botReplyText = 'เซิร์ฟเวอร์เกิดข้อผิดพลาดในการประมวลผลรูปภาพ';
      await client.pushMessage({ to: userId, messages: [{ type: 'text', text: botReplyText }] });
    }
  }

  // 🟢 บันทึกโครงสร้างข้อมูลลงตาราง Database (ปรับตัวแปรตามสไลด์อาจารย์)
  try {
    await supabase.from('messages').insert([
      {
        user_id: userId,
        message_id: messageId,
        type: messageType,
        content: content,
        reply_token: replyToken, // อ้างอิงตามชื่อฟิลด์หน้าสไลด์ 44
        reply_content: botReplyText 
      }
    ]);

    if (event.message.type === 'text') {
      return await client.replyMessage({
        replyToken: replyToken,
        messages: [{ type: 'text', text: botReplyText }],
      });
    }
  } catch (error) {
    console.error('Supabase DB Sync Error:', error);
  }
}

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});