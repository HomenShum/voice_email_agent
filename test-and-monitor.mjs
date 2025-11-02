#!/usr/bin/env node
/**
 * Comprehensive Test and Monitoring Script
 * Tests Azure Functions, Pinecone connectivity, and E2E test suite
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const reportFile = `test-report-${timestamp}.md`;

const args = process.argv.slice(2);
const skipFunctionCheck = args.includes('--skip-functions');
const skipPineconeCheck = args.includes('--skip-pinecone');
const skipTests = args.includes('--skip-tests');
const fullVerification = args.includes('--full');
const generateReport = !args.includes('--no-report');

console.log('\n╔════════════════════════════════════════════════════════════╗');
console.log('║     E2E Test Suite - Monitoring & Testing                  ║');
console.log(`║     ${new Date().toLocaleString().padEnd(50)}║`);
console.log('╚════════════════════════════════════════════════════════════╝\n');

// Load environment
console.log('[1/5] Loading environment...');
if (!fs.existsSync('.env')) {
    console.error('❌ .env file not found');
    process.exit(1);
}

process.env.JUDGE_DISABLE_LLM = '1';
if (fullVerification) {
    process.env.E2E_AGENT_VERIFY = '1';
    process.env.E2E_PINECONE_VERIFY = '1';
}
console.log('✅ Environment loaded\n');

// Step 1: Check Azure Functions
if (!skipFunctionCheck) {
    console.log('[2/5] Checking Azure Functions...');
    const functionsBase = process.env.FUNCTIONS_BASE || 'http://localhost:7071';
    console.log(`  Functions Base: ${functionsBase}`);
    
    try {
        const healthRes = await fetch(`${functionsBase}/api/health`);
        if (healthRes.ok) {
            console.log('  ✅ Health endpoint: OK');
        } else {
            console.log(`  ⚠️  Health endpoint: ${healthRes.status}`);
        }
    } catch (err) {
        console.log('  ⚠️  Health endpoint: Not responding');
        console.log('     Make sure dev host is running: node tests/dev-host.cjs');
    }
    
    try {
        const statsRes = await fetch(`${functionsBase}/api/index/stats`);
        if (statsRes.ok) {
            const stats = await statsRes.json();
            const recordCount = Object.values(stats.session?.dense?.byNamespace || {})[0]?.records || 0;
            console.log(`  ✅ Index stats: ${recordCount} records`);
        } else {
            console.log(`  ⚠️  Index stats: ${statsRes.status}`);
        }
    } catch (err) {
        console.log('  ⚠️  Index stats: Not responding');
    }
} else {
    console.log('[2/5] Skipping Azure Functions check\n');
}

// Step 2: Check Pinecone
if (!skipPineconeCheck) {
    console.log('[3/5] Checking Pinecone connectivity...');
    
    if (!process.env.PINECONE_API_KEY) {
        console.log('  ⚠️  PINECONE_API_KEY not set');
    } else {
        console.log('  ✅ PINECONE_API_KEY configured');
    }
    
    if (!process.env.PINECONE_INDEX_HOST) {
        console.log('  ⚠️  PINECONE_INDEX_HOST not set');
    } else {
        console.log('  ✅ PINECONE_INDEX_HOST configured');
    }
    
    if (!process.env.NYLAS_GRANT_ID) {
        console.log('  ⚠️  NYLAS_GRANT_ID not set');
    } else {
        console.log(`  ✅ NYLAS_GRANT_ID configured: ${process.env.NYLAS_GRANT_ID.substring(0, 8)}...`);
    }
} else {
    console.log('[3/5] Skipping Pinecone check\n');
}

// Step 3: Run E2E Tests
if (!skipTests) {
    console.log('[4/5] Running E2E test suite...');
    console.log(`  Mode: ${fullVerification ? 'Full Verification' : 'Fast Mode'}\n`);
    
    await new Promise((resolve, reject) => {
        const proc = spawn('npm', ['run', 'test:e2e'], {
            stdio: 'inherit',
            shell: true,
            cwd: __dirname
        });
        
        proc.on('close', (code) => {
            if (code === 0) {
                console.log('\n✅ E2E tests completed\n');
                resolve();
            } else {
                console.log('\n❌ E2E tests failed\n');
                reject(new Error(`Tests exited with code ${code}`));
            }
        });
    }).catch(err => {
        console.error('Error running tests:', err.message);
    });
} else {
    console.log('[4/5] Skipping E2E tests\n');
}

// Step 4: Analyze Results
console.log('[5/5] Analyzing test results...');

const resultsDir = path.join(__dirname, 'tests', 'results');
const summaryFiles = fs.readdirSync(resultsDir)
    .filter(f => f.startsWith('summary-') && f.endsWith('.json'))
    .sort()
    .reverse();

if (summaryFiles.length > 0) {
    const latestSummary = path.join(resultsDir, summaryFiles[0]);
    const summary = JSON.parse(fs.readFileSync(latestSummary, 'utf8'));
    
    console.log('\n  Test Summary:');
    console.log(`  ├─ Total Tests: ${summary.results.length}`);
    
    const passed = summary.results.filter(r => r.judge?.pass).length;
    const failed = summary.results.length - passed;
    
    console.log(`  ├─ Passed: ${passed}`);
    if (failed > 0) {
        console.log(`  ├─ Failed: ${failed}`);
    }
    
    const toolVerified = summary.results.filter(r => r.agent?.tool_verification?.passed).length;
    console.log(`  ├─ Tool Verification: ${toolVerified}/${summary.results.length}`);
    
    const pineconeTests = summary.results.filter(r => r.index_increase);
    if (pineconeTests.length > 0) {
        const totalDelta = pineconeTests.reduce((sum, r) => sum + (r.index_increase?.delta || 0), 0);
        console.log(`  ├─ Pinecone Delta: +${totalDelta} records`);
    }
    
    console.log(`  └─ Snapshot: ${summaryFiles[0]}`);
} else {
    console.log('  ⚠️  No test results found');
}

// Generate Report
if (generateReport && summaryFiles.length > 0) {
    console.log('\n📝 Generating report...');
    
    const latestSummary = path.join(resultsDir, summaryFiles[0]);
    const summary = JSON.parse(fs.readFileSync(latestSummary, 'utf8'));
    
    const passed = summary.results.filter(r => r.judge?.pass).length;
    const failed = summary.results.length - passed;
    const toolVerified = summary.results.filter(r => r.agent?.tool_verification?.passed).length;
    const pineconeTests = summary.results.filter(r => r.index_increase);
    const totalDelta = pineconeTests.reduce((sum, r) => sum + (r.index_increase?.delta || 0), 0);
    
    let report = `# E2E Test Report
**Generated**: ${new Date().toLocaleString()}

## Environment
- Functions Base: ${process.env.FUNCTIONS_BASE || 'http://localhost:7071'}
- Pinecone Index: ${process.env.PINECONE_INDEX_NAME || 'emails'}
- Nylas Grant: ${process.env.NYLAS_GRANT_ID?.substring(0, 8)}...

## Test Configuration
- Full Verification: ${fullVerification}
- Tool Verification: ${process.env.E2E_AGENT_VERIFY === '1'}
- Pinecone Verification: ${process.env.E2E_PINECONE_VERIFY === '1'}
- LLM Judge: Disabled

## Results
- Total Tests: ${summary.results.length}
- Passed: ${passed}
${failed > 0 ? `- Failed: ${failed}\n` : ''}
- Tool Verification: ${toolVerified}/${summary.results.length}
${pineconeTests.length > 0 ? `- Pinecone Records Added: +${totalDelta}\n` : ''}

## Test Cases
`;
    
    for (const result of summary.results) {
        const status = result.judge?.pass ? '✅' : '❌';
        report += `- ${status} ${result.id}\n`;
    }
    
    report += `\n## Snapshot Location
- Summary: ${summaryFiles[0]}
`;
    
    fs.writeFileSync(reportFile, report, 'utf8');
    console.log(`✅ Report saved: ${reportFile}`);
}

console.log('\n╔════════════════════════════════════════════════════════════╗');
console.log('║     Testing Complete                                       ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');

console.log('📊 Next Steps:');
console.log('  1. Review test results: tests/results/');
console.log('  2. Check tool invocations: cat tests/results/security-alert-*.json | jq \'.agent.tool_events\'');
console.log('  3. Monitor Pinecone: cat tests/results/unread-delta-*.json | jq \'.index_increase\'');
console.log('  4. Read guide: tests/MONITORING_GUIDE.md\n');

