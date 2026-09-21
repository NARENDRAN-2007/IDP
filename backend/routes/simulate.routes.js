const express = require('express');
const router = express.Router();
const { resetStore } = require('../state/store');

router.post('/reset', (req, res) => {
  resetStore();
  res.json({ ok: true, message: 'State re-seeded successfully' });
});

module.exports = router;
