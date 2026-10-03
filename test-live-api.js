// test-live-api.js
// Smoke test: hits deployed /api/match endpoint and verifies scoreboard for match 71323

const BASE_URL = 'https://cric-beacon.vercel.app';
const MATCH_ID = 71323;

// Expected scores per the M3 live check doc
const EXPECTED = {
  inn1Runs: 168, inn1Wickets: 7,
  inn2Runs: 169, inn2Wickets: 5
};

async function main() {
  console.log(`\n📡 Fetching live /api/match?id=${MATCH_ID}...\n`);

  try {
    const res = await fetch(`${BASE_URL}/api/match?id=${MATCH_ID}`);

    if (!res.ok) {
      console.error(`❌ HTTP ${res.status}: ${res.statusText}`);
      process.exit(1);
    }

    const data = await res.json();

    console.log('✅ Fetched match data');
    console.log(`   Match: ${data.label} (${data.format})`);
    console.log(`   Status: ${data.status}`);

    if (!data.innings) {
      console.error('❌ Response missing innings object');
      process.exit(1);
    }

    // Innings structure:
    //   firstInningsAway = away team (Knights) runs in their innings
    //   firstInningsAwayWickets = away team wickets
    //   firstInningsHome = home team (Western Province) runs in their innings
    //   firstInningsHomeWickets = home team wickets
    const inn1Runs = data.innings.firstInningsAway;
    const inn1Wickets = data.innings.firstInningsAwayWickets;
    const inn2Runs = data.innings.firstInningsHome;
    const inn2Wickets = data.innings.firstInningsHomeWickets;

    const actual1 = { runs: inn1Runs, wickets: inn1Wickets };
    const actual2 = { runs: inn2Runs, wickets: inn2Wickets };

    console.log('');
    console.log('📊 Innings 1 (expected):', `${EXPECTED.inn1Runs}/${EXPECTED.inn1Wickets}`);
    console.log('📊 Innings 1 (actual):  ', `${actual1.runs}/${actual1.wickets}`);
    console.log('');
    console.log('📊 Innings 2 (expected):', `${EXPECTED.inn2Runs}/${EXPECTED.inn2Wickets}`);
    console.log('📊 Innings 2 (actual):  ', `${actual2.runs}/${actual2.wickets}`);
    console.log('');

    const match1 = actual1.runs === EXPECTED.inn1Runs && actual1.wickets === EXPECTED.inn1Wickets;
    const match2 = actual2.runs === EXPECTED.inn2Runs && actual2.wickets === EXPECTED.inn2Wickets;

    if (match1 && match2) {
      console.log('✅ Both innings match expected scoreboard');
      process.exit(0);
    } else {
      if (!match1) console.error('❌ Innings 1 mismatch');
      if (!match2) console.error('❌ Innings 2 mismatch');
      process.exit(1);
    }

  } catch (err) {
    console.error('❌ Request failed:', err.message);
    process.exit(1);
  }
}

main();