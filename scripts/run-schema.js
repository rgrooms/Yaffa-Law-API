const fs = require('fs');
const path = require('path');

const SUPABASE_URL = 'https://yqdujzqzpudpsbbvebnf.supabase.co';
const SERVICE_KEY  = 'sb_secret_YjfherzGC7CusYiJHxakpg_csUJGl6-';

async function runSQL(sql) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
    method: 'POST',
    headers: {
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  });
  return res;
}

// Use Supabase management API to run raw SQL
async function runSchemaSql(sql) {
  const res = await fetch(`${SUPABASE_URL}/pg/query`, {
    method: 'POST',
    headers: {
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  });
  return res;
}

async function main() {
  const schemaPath = path.join(__dirname, '../schema.sql');
  const fullSql = fs.readFileSync(schemaPath, 'utf8');

  // Split into individual statements
  const statements = fullSql
    .split(/;\s*\n/)
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--') && !s.startsWith('/*'));

  console.log(`Running ${statements.length} SQL statements via Supabase REST...\n`);

  let ok = 0, failed = 0;
  for (const stmt of statements) {
    const shortStmt = stmt.slice(0, 60).replace(/\n/g, ' ');
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/query`, {
        method: 'POST',
        headers: {
          'apikey': SERVICE_KEY,
          'Authorization': `Bearer ${SERVICE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation',
        },
        body: JSON.stringify({ sql: stmt }),
      });

      if (res.status < 400) {
        console.log(`✅ OK: ${shortStmt}`);
        ok++;
      } else {
        const body = await res.text();
        if (body.includes('already exists') || body.includes('duplicate')) {
          console.log(`⏩ Skip (exists): ${shortStmt}`);
          ok++;
        } else {
          console.log(`❌ FAILED (${res.status}): ${shortStmt}`);
          console.log(`   ${body.slice(0, 120)}`);
          failed++;
        }
      }
    } catch (e) {
      console.log(`❌ ERROR: ${shortStmt} — ${e.message}`);
      failed++;
    }
  }

  console.log(`\nDone: ${ok} OK, ${failed} failed.`);
  
  if (failed > 0) {
    console.log('\n⚠️  Some statements failed. Copy schema.sql and run it manually in:');
    console.log('   Supabase Dashboard → SQL Editor → New Query → paste → Run');
  }
}

main();
