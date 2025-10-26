import http from 'http';

async function testEmailCount() {
  const body = JSON.stringify({
    namespace: '22dd5c25-157e-4377-af23-e06602fdfcec',
    filters: { type: { $eq: 'message' } }
  });

  return new Promise((resolve, reject) => {
    const req = http.request('http://localhost:8787/email/count', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log(`[/email/count] Status: ${res.statusCode}`);
        console.log(`Response:`, data);
        resolve();
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function testBackfillSync() {
  const body = JSON.stringify({
    grantId: '22dd5c25-157e-4377-af23-e06602fdfcec',
    max: 10000,
    months: 1
  });

  return new Promise((resolve, reject) => {
    const req = http.request('http://localhost:8787/sync/backfill', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log(`[/sync/backfill] Status: ${res.statusCode}`);
        console.log(`Response:`, data);
        resolve();
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  console.log('Testing /email/count endpoint...');
  await testEmailCount();

  console.log('\nTesting /sync/backfill endpoint (10k emails)...');
  await testBackfillSync();
}

main().catch(console.error);

