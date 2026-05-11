const express = require('express');
const line = require('@line/bot-sdk');

const app = express();
const PORT = 3002; 

// ตั้งค่าจาก LINE Developers Console
const config = {
  channelAccessToken: 'oC0Ly7c8MMC/6V2WJcXy25Hwgntj6Xe8C+UvUdhWpoWLS/d6OagV3cyDRrswIU9H9126WXBqiZg8yhoKmcJBIXHJOTfuNyTMXlXaiupMlBg93vel6pSYrJ2ZlNbPCBJXOvaNH7Cn9gc52q0ZLJ05dQdB04t89/1O/w1cDnyilFU=',
  channelSecret: '54fa655b9b5dc98e3c82ce902c09a8ae'
};

const client = new line.messagingApi.MessagingApiClient({
  channelAccessToken: config.channelAccessToken
});

// หน้าแรกสำหรับตรวจสอบว่า Server ของเราทำงานหรือไม่
app.get('/', (req, res) => {
  res.send('Hello world!, thanakrit (Port 3002)test');
});

// Middleware สำหรับ Log ดู Request (ยกเว้น webhook เพื่อไม่ให้กวน line middleware)
app.use((req, res, next) => {
  if (req.url !== '/webhook') {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  }
  next();
});

// LINE Webhook Setup
app.use('/webhook', line.middleware(config));

app.post('/webhook', (req, res) => {
  Promise
    .all(req.body.events.map(handleEvent))
    .then(result => res.json(result))
    .catch(err => {
      console.error('Error handling webhook event:', err);
      res.status(500).end();
    });
});

// ฟังก์ชันตอบกลับข้อความ
function handleEvent(event) {
  if (event.type !== 'message' || event.message.type !== 'text') {
    return Promise.resolve(null);
  }

  return client.replyMessage({
    replyToken: event.replyToken,
    messages: [{
      type: 'text',
      text: `คุณพิมพ์ว่า: ${event.message.text}`
    }]
  });
}

// Error Handling สำหรับ LINE Signature หรือปัญหาอื่นๆ
app.use((err, req, res, next) => {
  if (err instanceof line.SignatureValidationFailed) {
    console.error('Signature validation failed:', err.signature);
    res.status(401).send('Invalid Signature');
    return;
  } else if (err instanceof line.JSONParseError) {
    console.error('JSON Parse Error:', err.raw);
    res.status(400).send('Bad Request');
    return;
  }
  console.error('Global Error:', err);
  res.status(500).send('Internal Server Error');
});

// สั่งให้ Server เริ่มทำงานที่พอร์ต 3099 เท่านั้น
app.listen(PORT, () => {
  console.log(`thanakrit-express-app is running at http://localhost:${PORT}`);
});