const express = require('express');
const router = express.Router();
const { store } = require('../state/store');

router.get('/', (req, res) => {
  res.json({ ok: true, data: store.ambulances });
});

module.exports = router;
