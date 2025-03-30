const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const express = require('express');
const https = require('https');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const axios = require('axios');

require('dotenv').config();

const sendNotification = async (message, sound) => {
  try {
    const response = await axios.post(process.env.PUSHOVER_API, null, {
      params: {
        token: process.env.APITOKEN,
        user: process.env.USERKEY,
        message: message,
        sound: sound,
        priority: 1,
      },
    });

    console.log('Benachrichtigung gesendet:', response.data);
  } catch (error) {
    console.error('Fehler beim Senden der Benachrichtigung:', error);
  }
};

const app = express();

// ✅ SSL-Zertifikate für HTTPS
const CERT_PATH = process.env.CERT_PATH;
const httpsOptions = {
  key: fs.readFileSync(`${CERT_PATH}privkey.pem`),
  cert: fs.readFileSync(`${CERT_PATH}fullchain.pem`),
};

// ✅ HTTPS-Server zuerst erstellen
const httpsServer = https.createServer(httpsOptions, app);
const httpServer = http.createServer(app);

// ✅ WebSockets an HTTPS binden
const io = socketIo(httpsServer, {
  cors: {
    origin: process.env.SOCKET_ORIGINS?.split(',') || [],
    methods: ['GET', 'POST'],
    allowedHeaders: ['my-custom-header'],
    credentials: true,
  },
  transports: ['websocket', 'polling'],
});

// ✅ CORS & Middleware
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',')
  : [];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
  })
);

// Middleware für JSON-Parsing
app.use(express.json());

// Bereitstellung statischer Dateien
app.use(express.static('public'));

app.get('/.well-known/acme-challenge/:content', (req, res) => {
  const filePath = `public/.well-known/acme-challenge/${req.params.content}`;
  if (fs.existsSync(filePath)) {
    res.sendFile(filePath, { root: '.' });
  } else {
    res.status(404).send('Not Found');
  }
});

// Datenbank erstellen oder öffnen
const db = new sqlite3.Database(process.env.DB_PATH, (err) => {
  if (err) console.error('Datenbank-Fehler:', err.message);
  else console.log('SQLite-Datenbank verbunden.');
});

db.serialize(() => {
  db.run(
    `CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY, 
      name TEXT, 
      anrede TEXT, 
      betreff TEXT, 
      unternehmen TEXT, 
      anschreiben TEXT
    )`
  );
});
db.serialize(() => {
  db.run(
    `CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY, 
      text TEXT, 
      user_id INTEGER, 
      senderRole TEXT
    )`
  );
  db.run(`ALTER TABLE messages ADD COLUMN receiver_id INTEGER`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
      console.error('❌ Fehler beim Hinzufügen von receiver_id:', err.message);
    } else {
      console.log(
        "📦 Spalte 'receiver_id' erfolgreich hinzugefügt oder bereits vorhanden."
      );
    }
  });
});

db.run('PRAGMA journal_mode=DELETE;');

// ✅ API-Endpunkte
app.get('/api/getData/:id', (req, res) => {
  const id = req.params.id;

  const sql =
    'SELECT id, unternehmen AS company, name, anrede, betreff, anschreiben AS message FROM users WHERE id = ?';

  db.get(sql, [id], (err, row) => {
    if (err) {
      console.error('Fehler beim Abrufen der Daten:', err.message);
      return res
        .status(500)
        .json({ success: false, message: 'Fehler beim Abrufen der Daten.' });
    }

    if (row) {
      row.message = row.message.replace(/\r\n/g, '<br>');
      res.json({ success: true, data: row });
    } else {
      res.json({ success: false, message: 'Kein Eintrag gefunden.' });
    }
  });
});

// API-Route: Lade Nachrichten eines bestimmten Benutzers
app.get('/api/messages/:id', (req, res) => {
  const userId = req.params.id;

  // Prüfe, ob die ID gültig ist
  if (!userId) {
    return res
      .status(400)
      .json({ success: false, message: 'Ungültige Benutzer-ID' });
  }

  console.log(`📨 Lade Nachrichten für Benutzer ${userId}`);

  // Admin bekommt ALLE Nachrichten, normale User nur ihre eigenen
  const sql =
    userId === '0'
      ? 'SELECT * FROM messages ORDER BY id ASC' // Admin bekommt alle
      : 'SELECT * FROM messages WHERE user_id = ? ORDER BY id ASC';

  db.all(sql, userId !== '0' ? [userId] : [], (err, rows) => {
    if (err) {
      console.error('❌ Fehler beim Abrufen der Nachrichten:', err.message);
      return res
        .status(500)
        .json({ success: false, message: 'Fehler beim Laden der Nachrichten' });
    }

    if (rows.length > 0) {
      console.log(`📬 Nachrichten für Benutzer ${userId} gefunden.`);
      res.json({ success: true, messages: rows });
    } else {
      console.log(`⚠️ Keine Nachrichten für Benutzer ${userId} gefunden.`);
      res.json({ success: false, messages: [] });
    }
  });
});

// Lade alle Benutzer
app.get('/api/users', (req, res) => {
  const sql =
    'SELECT id, name, anrede, betreff, unternehmen AS company FROM users';

  db.all(sql, [], (err, rows) => {
    if (err) {
      console.error('❌ Fehler beim Abrufen der Benutzer:', err.message);
      return res
        .status(500)
        .json({ success: false, message: 'Fehler beim Laden der Benutzer' });
    }

    if (rows.length > 0) {
      console.log(`👥 ${rows.length} Benutzer gefunden.`);
      res.json({ success: true, users: rows });
    } else {
      console.log('⚠️ Keine Benutzer gefunden.');
      res.json({ success: false, users: [] });
    }
  });
});

// Nutzer löschen
app.delete('/api/user/:id', (req, res) => {
  const { id } = req.params;

  db.serialize(() => {
    db.run('BEGIN TRANSACTION');

    // 1. Nachrichten löschen
    db.run(`DELETE FROM messages WHERE user_id = ?`, [id], function (err) {
      if (err) {
        console.error('❌ Fehler beim Löschen der Nachrichten:', err);
        db.run('ROLLBACK');
        return res.status(500).json({ success: false });
      }

      // 2. Nutzer löschen
      db.run(`DELETE FROM users WHERE id = ?`, [id], function (err2) {
        if (err2) {
          console.error('❌ Fehler beim Löschen des Nutzers:', err2);
          db.run('ROLLBACK');
          return res.status(500).json({ success: false });
        }

        db.run('COMMIT');
        return res.json({ success: true });
      });
    });
  });
});

// API für Login
app.post('/api/login', (req, res) => {
  const { name, unternehmen } = req.body;
  console.log('🔑 Login-Anfrage:', name, unternehmen);

  if (
    name === process.env.ADMIN_NAME &&
    unternehmen === process.env.ADMIN_UNTERNEHMEN
  ) {
    return res.json({
      success: true,
      userId: parseInt(process.env.ADMIN_ID),
      message: 'Admin angemeldet',
    });
  }

  const sql = 'SELECT id FROM users WHERE name = ? AND unternehmen = ?';

  db.get(sql, [name.trim(), unternehmen.trim()], (err, row) => {
    if (err) {
      console.error('SQL-Fehler:', err.message);
      return res
        .status(500)
        .json({ success: false, message: 'Interner Serverfehler' });
    }
    if (row) {
      res.json({
        success: true,
        userId: row.id,
        message: 'Login erfolgreich',
      });
    } else {
      res.json({ success: false, message: 'Ungültige Zugangsdaten' });
    }
  });
});

// Neuen Nutzer anlegen
app.post('/api/createUser', (req, res) => {
  const { name, anrede, betreff, unternehmen, anschreiben, startMessage } =
    req.body;

  if (!name || !anrede || !betreff || !unternehmen || !anschreiben) {
    return res
      .status(400)
      .json({ success: false, message: 'Bitte alle Felder ausfüllen.' });
  }

  db.run(
    `INSERT INTO users (name, anrede, betreff, unternehmen, anschreiben) VALUES (?, ?, ?, ?, ?)`,
    [name, anrede, betreff, unternehmen, anschreiben],
    function (err) {
      if (err) {
        console.error('❌ Fehler beim Anlegen des Nutzers:', err);
        return res.status(500).json({ success: false });
      }

      const userId = this.lastID;

      if (startMessage && startMessage.trim() !== '') {
        db.run(
          `INSERT INTO messages (text, user_id, senderRole) VALUES (?, ?, ?)`,
          [startMessage, userId, 'admin']
        );
      }

      return res.status(200).json({ success: true, id: userId });
    }
  );
});

// Nutzererstellung für Nutzer
app.post('/api/registerSimpleUser', (req, res) => {
  const { name, unternehmen } = req.body;

  if (!name || !unternehmen) {
    return res.status(400).json({ success: false, message: 'Name und Unternehmen erforderlich.' });
  }

  db.run(
    `INSERT INTO users (name, anrede, betreff, unternehmen, anschreiben) VALUES (?, '', '', ?, '')`,
    [name.trim(), unternehmen.trim()],
    function (err) {
      if (err) {
        console.error('❌ Fehler beim Erstellen des Nutzers:', err.message);
        return res.status(500).json({ success: false });
      }

      res.json({ success: true, userId: this.lastID });
    }
  );
});

// Nachricht löschen
app.delete('/api/message/:id', (req, res) => {
  const msgId = req.params.id;
  db.run('DELETE FROM messages WHERE id = ?', [msgId], function (err) {
    if (err) {
      console.error('❌ Fehler beim Löschen der Nachricht:', err.message);
      return res.status(500).json({ success: false });
    }
    console.log(`🗑️ Nachricht mit ID ${msgId} gelöscht.`);
    res.json({ success: true });
  });
});

// Socket.io für den Chat mit Admin-Unterstützung
db.serialize(() => {
  io.on('connection', (socket) => {
    socket.on('userConnected', ({ userId }) => {
      console.log(`🔹 User ${userId} ist verbunden.`);
      socket.userId = userId;

      const sql =
        userId === 0
          ? 'SELECT * FROM messages ORDER BY id ASC'
          : 'SELECT * FROM messages WHERE user_id = ? ORDER BY id ASC';

      db.all(sql, userId !== 0 ? [userId] : [], (err, rows) => {
        if (!err) {
          socket.emit('chatHistorie', rows);
          console.log(
            `📜 Chat-Historie für ${
              userId === 0 ? 'Admin' : 'User ' + userId
            } gesendet.`
          );
        } else {
          console.error('❌ Fehler beim Laden der Chat-Historie:', err.message);
        }
      });
    });

    socket.on('chatNachricht', (msg) => {
      try {
        const data = JSON.parse(msg);
        const { message, userId, receiverId, senderRole } = data;
        console.log(`💬 Neue Nachricht von ${userId}: ${message}`);

        db.run(
          'INSERT INTO messages (text, user_id, receiver_id, senderRole) VALUES (?, ?, ?, ?)',
          [message, userId, receiverId, senderRole],
          function (err) {
            if (err) {
              console.error('❌ Fehler beim Speichern:', err.message);
            } else {
              console.log(`✅ Nachricht gespeichert, ID: ${this.lastID}`);

              const newMessage = {
                id: this.lastID,
                text: message,
                senderRole,
                userId,
                receiverId,
              };
              io.emit('neueNachricht', { userId, message: newMessage });

              // 📌 Richtig: User-Namen aus der Datenbank abrufen
              db.get(
                'SELECT name FROM users WHERE id = ?',
                [userId],
                (err, row) => {
                  if (err) {
                    console.error(
                      '❌ Fehler beim Abrufen des User-Namens:',
                      err.message
                    );
                    sendNotification(`Neue Nachricht: ${message}`, 'siren');
                  } else if (row) {
                    if (senderRole !== 'admin') {
                      sendNotification(
                        `Nachricht von ${row.name}: ${message}`,
                        'mechanical'
                      );
                    }
                  } else {
                    sendNotification(`Unbekannter User: ${message}`, 'siren');
                  }
                }
              );
            }
          }
        );
      } catch (error) {
        console.error('❌ Fehler beim Parsen der Nachricht:', error);
      }
    });

    socket.on('disconnect', () => {
      console.log(
        `❌ User ${socket.userId || 'Unbekannt'} hat die Verbindung getrennt.`
      );
    });
  });
});

// HTTP-Server für Weiterleitung auf HTTPS
httpServer.listen(3001, () => {
  console.log('🔄 HTTP-Server auf http://localhost:3001 (leitet auf HTTPS um)');
});

httpsServer.listen(443, () => {
  console.log(
    `🔒 HTTPS-Server mit WebSockets läuft auf ${process.env.PUBLIC_URL}`
  );
});
