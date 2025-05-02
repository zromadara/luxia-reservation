
const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const nodemailer = require('nodemailer');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config();
const app = express();
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
});

const Reservation = mongoose.model('Reservation', {
  nom: String,
  email: String,
  telephone: String,
  type: String,
  date_arrivee: String,
  date_depart: String,
  message: String
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/views/reservation.html'));
});

app.post('/reserver', async (req, res) => {
  const data = req.body;
  const reservation = new Reservation(data);
  await reservation.save();

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.MAIL_USER,
      pass: process.env.MAIL_PASS
    }
  });

  const mailOptions = {
    from: process.env.MAIL_USER,
    to: [process.env.MAIL_USER, data.email],
    subject: 'Confirmation de réservation – Luxia Résidence',
    text: `Bonjour ${data.nom},\n\nVotre réservation du ${data.date_arrivee} au ${data.date_depart} a bien été reçue.\n\nMerci,\nLuxia Résidence`
  };

  transporter.sendMail(mailOptions, (err, info) => {
    if (err) console.error(err);
  });

  res.send('<h2>Merci ! Votre réservation a été envoyée.</h2><a href="/">Retour</a>');
});

app.listen(3000, () => console.log('Serveur lancé sur http://localhost:3000'));
