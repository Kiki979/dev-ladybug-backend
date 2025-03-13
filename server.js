const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: '*',
  },
});

// CORS aktivieren
const allowedOrigins = [
  'http://localhost:3000',
  'https://nadine-kickhaefer.netlify.app', // Netlify-Frontend
];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
  })
);

// Middleware für JSON-Parsing
app.use(express.json());

// Datenbank erstellen oder öffnen
const db = new sqlite3.Database('chat.db', (err) => {
  if (err) console.error('Datenbank-Fehler:', err.message);
  else console.log('SQLite-Datenbank verbunden.');
});

// Tabellen erstellen (wenn nicht existiert)
db.serialize(() => {
  db.run(
    'CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT, unternehmen TEXT, anschreiben TEXT)'
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
});

db.run('PRAGMA journal_mode=DELETE;');

app.get('/api/getData/:id', (req, res) => {
  const id = req.params.id;
  const sql =
    'SELECT id, unternehmen AS company, name, anschreiben AS message FROM users WHERE id = ?';

  db.get(sql, [id], (err, row) => {
    if (err) {
      console.error('Fehler beim Abrufen der Daten:', err.message);
      return res
        .status(500)
        .json({ success: false, message: 'Fehler beim Abrufen der Daten.' });
    }

    if (row) {
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
    return res.status(400).json({ success: false, message: 'Ungültige Benutzer-ID' });
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
      return res.status(500).json({ success: false, message: 'Fehler beim Laden der Nachrichten' });
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

// API-Route: Lade alle Benutzer
app.get('/api/users', (req, res) => {
  const sql = 'SELECT id, name FROM users ORDER BY name ASC';

  db.all(sql, [], (err, rows) => {
    if (err) {
      console.error('❌ Fehler beim Abrufen der Benutzer:', err.message);
      return res.status(500).json({ success: false, message: 'Fehler beim Laden der Benutzer' });
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


// API für Login
app.post('/api/login', (req, res) => {
  const { name, unternehmen } = req.body;
  console.log('Login-Anfrage:', name, unternehmen);

  // Falls der Admin sich anmeldet, bekommt er eine spezielle ID (z.B. 0)
  if (name === 'Admin' && unternehmen === 'System') {
    return res.json({
      success: true,
      userId: 0,
      anschreiben: 'Admin angemeldet',
    });
  }

  const sql =
    'SELECT id, anschreiben FROM users WHERE name = ? AND unternehmen = ?';
  db.get(sql, [name.trim(), unternehmen.trim()], (err, row) => {
    if (err) {
      console.error('SQL-Fehler:', err.message);
      return res
        .status(500)
        .json({ success: false, message: 'Interner Serverfehler' });
    }
    if (row) {
      res.json({ success: true, anschreiben: row.anschreiben, userId: row.id });
    } else {
      res.json({ success: false, message: 'Ungültige Zugangsdaten' });
    }
  });
});

// 🔥 Socket.io für den Chat mit Admin-Unterstützung
db.serialize(() => {
  io.on('connection', (socket) => {
    console.log('Neuer Benutzer verbunden:', socket.id);

    socket.on('userConnected', ({ userId }) => {
      console.log(`🔹 User ${userId} ist verbunden.`);
      socket.userId = userId;

      const sql =
        userId === 0
          ? 'SELECT * FROM messages ORDER BY id ASC' // Admin sieht ALLE Nachrichten
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
        const { message, userId, senderRole } = data;
        console.log(`💬 Neue Nachricht von ${senderRole}: ${message}`);
    
        db.run(
          'INSERT INTO messages (text, user_id, senderRole) VALUES (?, ?, ?)',
          [message, userId, senderRole],
          function (err) {
            if (err) {
              console.error('❌ Fehler beim Speichern:', err.message);
            } else {
              console.log(`✅ Nachricht gespeichert, ID: ${this.lastID}`);
    
              // 📤 Sende nur die neue Nachricht an die Clients
              const newMessage = {
                id: this.lastID,
                text: message,
                senderRole: senderRole,
              };
    
              io.emit('neueNachricht', { userId, message: newMessage });
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

// Server starten
server.listen(3001, () => {
  console.log('Server läuft auf http://localhost:3001');
});
