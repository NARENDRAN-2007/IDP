require('dotenv').config();
const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());


app.use('/api/emergency', require('./routes/emergency.routes'));
app.use('/api/hospitals', require('./routes/hospitals.routes'));
app.use('/api/ambulances', require('./routes/ambulances.routes'));
app.use('/api/simulate', require('./routes/simulate.routes'));

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));

