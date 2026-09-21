const fs = require('fs');
const path = require('path');

function getSeedData(fileName) {
  const filePath = path.join(__dirname, '..', 'data', fileName);
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function initStore() {
  return {
    hospitals: getSeedData('hospitals.seed.json'),
    ambulances: getSeedData('ambulances.seed.json'),
    requests: {},
    holds: {},
    nextHoldId: 1
  };
}

const store = initStore();

function updateStatus(request, newStatus) {
  request.status = newStatus;
  if (!request.statusLog) request.statusLog = [];
  request.statusLog.push({ status: newStatus, at: Date.now() });
}

function resetStore() {
  if (store.holds) {
    Object.values(store.holds).forEach((hold) => {
      if (hold && hold.timer) {
        clearTimeout(hold.timer);
        hold.timer = null;
      }
    });
  }
  store.hospitals = getSeedData('hospitals.seed.json');
  store.ambulances = getSeedData('ambulances.seed.json');
  store.requests = {};
  store.holds = {};
  store.nextHoldId = 1;
}

module.exports = { store, updateStatus, resetStore };
