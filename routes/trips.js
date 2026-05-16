const express = require('express');
const auth = require('../middleware/auth');
const fs = require('fs');
const path = require('path');

const router = express.Router();
const DB_PATH = path.join(__dirname, '../database/db.json');

// Helper to read DB
const readDB = () => {
    if (!fs.existsSync(DB_PATH)) {
        fs.writeFileSync(DB_PATH, JSON.stringify({ users: [], trips: [] }));
    }
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
};

const writeDB = (data) => {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
};

// Save a trip
router.post('/save', auth, (req, res) => {
    try {
        const { start, end, distance, duration, stops } = req.body;
        const db = readDB();
        
        const newTrip = {
            id: Date.now(),
            userId: req.user.id,
            start,
            end,
            distance,
            duration,
            stops: stops || [],
            createdAt: new Date().toISOString()
        };

        db.trips.push(newTrip);
        writeDB(db);

        res.status(201).send(newTrip);
    } catch (e) {
        res.status(400).send(e);
    }
});

// Get user trips
router.get('/', auth, (req, res) => {
    try {
        const db = readDB();
        const userTrips = db.trips.filter(t => t.userId === req.user.id);
        res.send(userTrips);
    } catch (e) {
        res.status(500).send(e);
    }
});

// Delete a trip
router.delete('/:id', auth, (req, res) => {
    try {
        const db = readDB();
        const tripIndex = db.trips.findIndex(t => t.id === parseInt(req.params.id) && t.userId === req.user.id);

        if (tripIndex === -1) {
            return res.status(404).send({ error: 'Trip not found' });
        }

        db.trips.splice(tripIndex, 1);
        writeDB(db);
        res.send({ message: 'Trip deleted' });
    } catch (e) {
        res.status(500).send(e);
    }
});

module.exports = router;
