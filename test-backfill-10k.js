// Test 10,000 email backfill

const grantId = '22dd5c25-157e-4377-af23-e06602fdfcec';
const max = 10000;
const months = 12;

const body = JSON.stringify({
  grantId,
  max,
  months
});

console.log('Triggering 10,000 email backfill...');
console.log('Request body:', body);
console.log('');

fetch('http://localhost:8787/sync/backfill', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body
})
  .then(r => r.json())
  .then(data => {
    console.log('Response:');
    console.log(JSON.stringify(data, null, 2));
    
    if (data.upserted) {
      console.log('');
      console.log(`✓ Successfully upserted ${data.upserted} emails in ${data.duration_ms}ms`);
      console.log(`  Pages processed: ${data.pages}`);
      console.log(`  Avg time per page: ${(data.duration_ms / data.pages).toFixed(0)}ms`);
    }
  })
  .catch(e => {
    console.error('Error:', e.message);
    process.exit(1);
  });

