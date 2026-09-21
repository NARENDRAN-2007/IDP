const CONFLICT_WINDOW_MS = 5000;

function resolveConflict(requestA, requestB) {
  const gap = Math.abs((requestA.createdAt || 0) - (requestB.createdAt || 0));
  if (gap > CONFLICT_WINDOW_MS) {
    return (requestA.createdAt || 0) < (requestB.createdAt || 0) ? [requestA, requestB] : [requestB, requestA];
  }
  const sevA = requestA.severityLevel !== null && requestA.severityLevel !== undefined ? requestA.severityLevel : 99;
  const sevB = requestB.severityLevel !== null && requestB.severityLevel !== undefined ? requestB.severityLevel : 99;

  if (sevA !== sevB) {
    return sevA < sevB ? [requestA, requestB] : [requestB, requestA];
  }
  return (requestA.createdAt || 0) <= (requestB.createdAt || 0) ? [requestA, requestB] : [requestB, requestA];
}

const pendingQueue = [];
let processingQueue = false;

function enqueueRequest(request, processCallback) {
  pendingQueue.push({ request, processCallback });
  if (!processingQueue) {
    processingQueue = true;
    setTimeout(() => {
      processQueue();
    }, 100);
  }
}

function processQueue() {
  if (pendingQueue.length === 0) {
    processingQueue = false;
    return;
  }

  // Sort all pending requests by severity tiebreak
  pendingQueue.sort((itemA, itemB) => {
    const res = resolveConflict(itemA.request, itemB.request);
    return res[0] === itemA.request ? -1 : 1;
  });

  const next = pendingQueue.shift();
  try {
    next.processCallback(next.request);
  } catch (err) {
    console.error('Error processing request queue item:', err);
  }

  if (pendingQueue.length > 0) {
    setTimeout(processQueue, 50);
  } else {
    processingQueue = false;
  }
}

module.exports = { resolveConflict, enqueueRequest, CONFLICT_WINDOW_MS };
