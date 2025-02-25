const express = require('express');
const nodemailer = require('nodemailer');

const app = express();
app.use(express.json());

app.post('/send-email', async (req, res) => {
  const { to, subject, text } = req.body;

  // Erstelle einen Transporter. Hier ein Beispiel mit Gmail.
  // Beachte: Für Gmail musst du evtl. "Zugriff durch weniger sichere Apps" aktivieren oder OAuth2 nutzen.
  let transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: 'nadine.kickhaefer@hotmail.de', // Deine E-Mail-Adresse
      pass: 'K43s3kuch3n79!', // Dein Passwort oder App-Passwort
    },
  });

  let mailOptions = {
    from: '"Dein Name" <deine.email@gmail.com>',
    to: to, // Empfänger-E-Mail-Adresse
    subject: subject,
    text: text,
  };

  try {
    let info = await transporter.sendMail(mailOptions);
    console.log('Email gesendet: ' + info.response);
    res.status(200).send('E-Mail erfolgreich gesendet');
  } catch (error) {
    console.error(error);
    res.status(500).send('Fehler beim Versenden der E-Mail');
  }
});

app.listen(3002, () => {
  console.log('Server läuft auf Port 3002');
});
