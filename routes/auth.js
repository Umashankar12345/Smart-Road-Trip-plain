const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

const router = express.Router();
const DB_PATH = path.join(__dirname, '../database/db.json');

// Helper to read DB (lowdb replacement for simplicity)
const readDB = () => {
    if (!fs.existsSync(DB_PATH)) {
        fs.writeFileSync(DB_PATH, JSON.stringify({ users: [], trips: [] }));
    }
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
};

const writeDB = (data) => {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
};

// Register
router.post('/register', async (req, res) => {
    try {
        const { email, password, name } = req.body;
        const db = readDB();
        
        if (db.users.find(u => u.email === email)) {
            return res.status(400).send({ error: 'Email already exists' });
        }

        const hashedPassword = await bcrypt.hash(password, 8);
        const newUser = { id: Date.now(), email, password: hashedPassword, name };
        
        db.users.push(newUser);
        writeDB(db);

        const token = jwt.sign({ id: newUser.id }, process.env.JWT_SECRET || 'srtp_secret_key_123');
        res.status(201).send({ user: { id: newUser.id, email, name }, token });
    } catch (e) {
        res.status(400).send(e);
    }
});

// Login
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const db = readDB();
        const user = db.users.find(u => u.email === email);

        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(400).send({ error: 'Invalid login credentials' });
        }

        const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET || 'srtp_secret_key_123');
        res.send({ user: { id: user.id, email: user.email, name: user.name }, token });
    } catch (e) {
        res.status(400).send(e);
    }
});

module.exports = router;
