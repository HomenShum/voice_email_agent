import http from 'http';

async function testEmailSearch() {
  const body = JSON.stringify({
    namespace: '22dd5c25-157e-4377-af23-e06602fdfcec',
    queries: [{ text: 'hello' }],
    top_k: 10
  });

  return new Promise((resolve, reject) => {
    const req = http.request('http://localhost:8787/email/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log(`[/email/search] Status: ${res.statusCode}`);
        try {
          const parsed = JSON.parse(data);
          console.log(`Total: ${parsed.total}, Results: ${parsed.results?.length || 0}`);
          if (parsed.results && parsed.results.length > 0) {
            console.log(`First result: ${parsed.results[0].metadata?.subject || 'N/A'}`);
          }
        } catch (e) {
          console.log(`Response:`, data);
        }
        resolve();
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

testEmailSearch().catch(console.error);

