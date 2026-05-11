// index.js
const express = require('express');
const line = require('@line/bot-sdk');
const app = express()
const port = 3099

app.get('/', (req, res) => {
  res.send('Hello world!,thanakrit')
})

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// ตั้งค่าจาก LINE Developers Console
const config = {
  channelAccessToken: 'oC0Ly7c8MMC/6V2WJcXy25Hwgntj6Xe8C+UvUdhWpoWLS/d6OagV3cyDRrswIU9H9126WXBqiZg8yhoKmcJBIXHJOTfuNyTMXlXaiupMlBg93vel6pSYrJ2ZlNbPCBJXOvaNH7Cn9gc52q0ZLJ05dQdB04t89/1O/w1cDnyilFU=',
  channelSecret: '54fa655b9b5dc98e3c82ce902c09a8ae'
};

app.use('/webhook', line.middleware(config));

// รับ webhook
app.post('/webhook', (req, res) => {
  Promise
    .all(req.body.events.map(handleEvent))
    .then(result => res.json(result))
    .catch(err => {
      console.error('Error handling webhook event:', err);
      res.status(500).end();
    });
});

// ตอบกลับข้อความ
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

const client = new line.messagingApi.MessagingApiClient({
  channelAccessToken: config.channelAccessToken
});

app.use((err, req, res, next) => {
  if (err instanceof line.SignatureValidationFailed) {
    console.error('Signature validation failed:', err.signature);
    res.status(401).send(err.signature);
    return;
  } else if (err instanceof line.JSONParseError) {
    console.error('JSON Parse Error:', err.raw);
    res.status(400).send(err.raw);
    return;
  }
  console.error('Global Error:', err);
  res.status(500).send(err.message);
});

const PORT = process.env.PORT || 3099;
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})