// ── ROULETTE ─────────────────────────────────────────────────────────────────
const RED = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
const FIB = [1,1,2,3,5,8,13,21,34,55,89,144,233];

const colorOf = n => n === 0 ? 'green' : RED.has(n) ? 'red' : 'black';
const opp     = c => c === 'red' ? 'black' : 'red';
const spin    = () => Math.floor(Math.random() * 37);

// Basiseinsatz kommt direkt aus dem Dropdown
const baseAmt = () => +document.getElementById('selBase').value;

const calcBet = (base, step, sys) =>
  sys === 'martingale' ? +(base * 2 ** step).toFixed(2) :
  sys === 'fibonacci'  ? +(base * FIB[Math.min(step, FIB.length-1)]).toFixed(2) :
                         +(base * (step + 1)).toFixed(2); // dalembert

const stepWin = (step, sys) =>
  sys === 'fibonacci' ? Math.max(0, step - 2) :
  sys === 'dalembert' ? Math.max(0, step - 1) : 0;

// ── DUTZEND (2:1) — ×1,5-Leiter, Wette aufs am längsten abwesende Dutzend ─────
const dozenOf = n => (n>=1&&n<=12)?1:(n>=13&&n<=24)?2:(n>=25&&n<=36)?3:null;
const dozenBet = (base, step) => +(Math.round(base * Math.pow(1.5, step) * 10) / 10).toFixed(2);
function dozAbsence(nums) {
  const ab = {1:0, 2:0, 3:0};
  for (const d of [1,2,3]) { let a=0; for (let i=0;i<nums.length;i++){ if(dozenOf(nums[i])===d) break; a++; } ab[d]=a; }
  let best=1; for (const d of [2,3]) if (ab[d] > ab[best]) best=d;
  return { best, abs: ab[best], matched: ab[best] >= CFG.DOZEN };
}

// ── PATTERN DETECTION (ported from bot) ─────────────────────────────────────
const CFG = { STREAK:3, ALT:4, DD:3, BLOCK:5, DOZEN:2, MG_MAX:15 };

function leadRun(cs) {
  if (!cs.length || !cs[0] || cs[0]==='green') return 0;
  let k=1; for(let i=1;i<cs.length;i++){if(cs[i]===cs[0])k++;else break;} return k;
}
function leadAlt(cs) {
  if (!cs.length || !cs[0] || cs[0]==='green') return 0;
  let k=1; for(let i=1;i<cs.length;i++){if(!cs[i]||cs[i]==='green'||cs[i]===cs[i-1])break;k++;} return k;
}
function altDoubles(cs) {
  let p=0,i=0,prev=null;
  while(i+1<cs.length){const a=cs[i],b=cs[i+1];if(!a||a==='green'||a!==b)break;if(prev!==null&&a===prev)break;p++;prev=a;i+=2;} return p;
}
function blockBest(cs) {
  let best={len:0,offset:0,betColor:null};
  for(const A of ['red','black']){const B=opp(A);for(const sf of[false,true]){
    let bl={len:0,offset:0};
    for(let offset=0;offset<3;offset++){let len=0;for(let i=0;i<cs.length;i++){if(!cs[i]||cs[i]==='green')break;const p=((offset-i)%3+3)%3;const exp=sf?(p===0?B:A):(p<2?A:B);if(cs[i]!==exp)break;len++;}if(len>bl.len)bl={len,offset};}
    if(bl.len>best.len){const nextP=(bl.offset+1)%3;const expN=sf?(nextP===0?B:A):(nextP<2?A:B);best={len:bl.len,betColor:expN===A?B:A};}
  }}
  return best;
}

function analyze(cs) {
  const run=leadRun(cs), c0=cs[0];
  const alt=leadAlt(cs);
  const lead=altDoubles(cs);
  const blk=blockBest(cs);
  return [
    {key:'streak', runLen:run,  prog:Math.min(run,CFG.STREAK),  target:CFG.STREAK,
     matched:run>=CFG.STREAK&&!!c0&&c0!=='green',  betColor:run>=CFG.STREAK&&!!c0&&c0!=='green'?opp(c0):null},
    {key:'alt',    runLen:alt,  prog:Math.min(alt,CFG.ALT),     target:CFG.ALT,
     matched:alt>=CFG.ALT&&!!c0&&c0!=='green',     betColor:alt>=CFG.ALT&&!!c0&&c0!=='green'?c0:null},
    {key:'dd',     runLen:lead, prog:Math.min(lead,CFG.DD),     target:CFG.DD,
     matched:lead>=CFG.DD&&!!c0&&c0!=='green',     betColor:lead>=CFG.DD&&!!c0&&c0!=='green'?c0:null},
    {key:'block',  runLen:blk.len, prog:Math.min(blk.len,CFG.BLOCK), target:CFG.BLOCK,
     matched:blk.len>=CFG.BLOCK&&!!blk.betColor,  betColor:blk.len>=CFG.BLOCK?blk.betColor:null},
  ];
}

// Longest match wins; fixed priority (same order as analyze) as tiebreaker
function decide(pats, excludeKey) {
  let on = pats.filter(p=>p.matched&&p.betColor);
  if (excludeKey) on = on.filter(p=>p.key!==excludeKey);
  if (!on.length) return null;
  return on.reduce((a,b)=>b.runLen>a.runLen?b:a);
}

// ── STRATEGY STATE ───────────────────────────────────────────────────────────
const SYS = ['martingale','fibonacci','dalembert','dozen'];
const SYS_LABEL = {martingale:'Martingale ×2', fibonacci:'Fibonacci', dalembert:"D'Alembert", dozen:'Dutzend ×1,5'};

function mkState(budget, sys) {
  return {sys, budget0:budget, budget, pnl:0, bets:0, wins:0,
          step:0, base:0, firedKey:null, armed:true,
          pending:null, pendingAmt:0, busted:false, lastBet:null};
}

// tick: num = gefallene Zahl; pats = Farb-Muster; doz = Dutzend-Abwesenheit.
function tick(S, num, pats, doz) {
  if (S.busted) return;
  const spinColor = colorOf(num);
  const isDoz = S.sys === 'dozen';

  // 1. Settle (Dutzend 2:1, Farbe 1:1)
  if (S.pending !== null) {
    const won = isDoz ? (dozenOf(num) === S.pending) : (spinColor === S.pending);
    const payout = isDoz ? 2 : 1;
    const delta = won ? +(S.pendingAmt * payout).toFixed(2) : -S.pendingAmt;
    S.budget = +(S.budget + delta).toFixed(2);
    S.pnl    = +(S.pnl + delta).toFixed(2);
    S.bets++; if (won) S.wins++;
    if (won) {
      const ns = isDoz ? 0 : stepWin(S.step, S.sys); // Dutzend-Treffer beendet Zyklus
      if (ns > 0) S.step = ns;
      else { S.step=0; S.base=0; S.firedKey=null; S.armed=true; }
    } else {
      const ns = S.step + 1;
      const nb = isDoz ? dozenBet(S.base, ns) : calcBet(S.base, ns, S.sys);
      if (ns <= CFG.MG_MAX && S.budget >= nb) S.step = ns;
      else { S.step=0; S.base=0; S.firedKey=null; S.armed=true; }
    }
    S.pending=null; S.pendingAmt=0;
    if (S.budget <= 0) { S.busted=true; S.budget=0; return; }
  }

  // 2. Decide next bet
  let target=null, betAmt=0;

  if (isDoz) {
    // Dutzend: aufs am längsten abwesende setzen (×1,5-Leiter)
    if (S.step > 0) {
      if (doz.matched) { target=doz.best; betAmt=dozenBet(S.base, S.step); }
    } else {
      if (!doz.matched) S.armed=true;
      if (doz.matched && S.armed) { target=doz.best; betAmt=baseAmt(); S.base=betAmt; S.armed=false; }
    }
  } else {
    const d = decide(pats);
    if (S.step > 0) {
      const rd = (S.firedKey==='dd') ? decide(pats, 'dd') : d;
      if (rd) { target=rd.betColor; betAmt=calcBet(S.base, S.step, S.sys); S.firedKey=rd.key; }
    } else {
      if (!d) S.armed=true;
      if (d && S.armed) { target=d.betColor; betAmt=baseAmt(); S.base=betAmt; S.firedKey=d.key; S.armed=false; }
    }
  }

  S.lastBet = null;
  if (target !== null && betAmt>0 && S.budget>=betAmt) {
    S.pending=target; S.pendingAmt=betAmt;
    S.lastBet = isDoz ? {dozen:target, amt:betAmt} : {color:target, amt:betAmt};
  }
}

// ── SIM STATE ────────────────────────────────────────────────────────────────
let states=[], history=[], numHist=[], spinNo=0, maxSpins=500, timer=null, running=false;

function initSim() {
  const budget = +selBudget.value;
  maxSpins = +selSpins.value;
  states = SYS.map(s => mkState(budget, s));
  history = []; numHist = []; spinNo = 0;
  result.classList.remove('show');
  multiResult.classList.remove('show');
  renderAll();
}

function doOneSpin() {
  const num = spin();
  const c   = colorOf(num);
  history.unshift(c); if (history.length > 25) history.pop();
  numHist.unshift(num); if (numHist.length > 25) numHist.pop();
  spinNo++;
  const pats = analyze(history);
  const doz  = dozAbsence(numHist);
  states.forEach(S => tick(S, num, pats, doz));
  return {num, c, pats};
}

function renderAll(num, c, pats) {
  // Spin circle
  if (num !== undefined) {
    spinCircle.className = 'spin-circle ' + c;
    spinCircle.textContent = num;
  } else {
    spinCircle.className = 'spin-circle empty';
    spinCircle.textContent = '?';
  }
  spinCounter.textContent = `${spinNo} / ${maxSpins}`;

  // History
  const h12 = history.slice(0,12);
  historyEl.innerHTML =
    h12.map(x=>`<div class="dot ${x}"></div>`).join('') +
    Array(Math.max(0,12-h12.length)).fill('<div class="dot empty"></div>').join('');

  // Patterns
  if (pats) pats.forEach(p=>{
    const pe = document.getElementById('pat-'+p.key);
    const pp = document.getElementById('pp-'+p.key);
    if (pe) pe.className = 'pat' + (p.matched?' on':'');
    if (pp) pp.textContent = `${p.prog}/${p.target}${p.matched?' → '+(p.betColor==='red'?'🔴':'⚫'):''}`;
  });

  // Table
  tbody.innerHTML = states.map(S=>{
    const pnlC = S.pnl>0?'g':S.pnl<0?'r':'z';
    const budC = S.budget>S.budget0?'g':S.budget<S.budget0?'r':'z';
    const next = S.lastBet
      ? `${S.lastBet.dozen ? `${S.lastBet.dozen}. Dz` : (S.lastBet.color==='red'?'🔴':'⚫')} ${S.lastBet.amt.toFixed(2)} CHF`
      : S.busted ? '💀 Bust' : '– warte';
    const recov = S.step>0 ? `Stufe ${S.step}` : '–';
    const status = S.busted ? '<span class="r">BUST</span>' : S.step>0 ? '<span style="color:#ffcc80">RECOVERY</span>' : '<span class="z">scharf</span>';
    return `<tr class="${S.busted?'busted':''}">
      <td><b>${SYS_LABEL[S.sys]}</b></td>
      <td class="${budC}">${S.budget.toFixed(2)} CHF</td>
      <td class="${pnlC}">${S.pnl>=0?'+':''}${S.pnl.toFixed(2)} CHF</td>
      <td>${S.wins}W / ${S.bets-S.wins}L</td>
      <td>${recov}</td>
      <td>${next}</td>
      <td>${status}</td>
    </tr>`;
  }).join('');
}

function showResult() {
  const sorted = [...states].sort((a,b)=>b.pnl-a.pnl);
  const w = sorted[0];
  const medal = w.pnl>0?'🏆':w.pnl===0?'🤝':'💸';
  rTitle.textContent = `${medal} ${spinNo} Spins — Bestes: ${SYS_LABEL[w.sys]}`;
  rGrid.innerHTML = states.map(S=>{
    const pC=S.pnl>0?'g':S.pnl<0?'r':'z';
    const wr=S.bets>0?((S.wins/S.bets)*100).toFixed(1):'-';
    return `<div class="result-box">
      <div class="result-sys">${SYS_LABEL[S.sys]}</div>
      <div class="result-pnl ${pC}">${S.pnl>=0?'+':''}${S.pnl.toFixed(2)} CHF</div>
      <div class="result-detail">${S.bets} Wetten · ${wr}% Win · ${S.busted?'💀 Bust':S.budget.toFixed(0)+' CHF'}</div>
    </div>`;
  }).join('');
  const theor = `Theoretischer Haus-Vorteil: ${((1/37)*100).toFixed(2)}% (Grüne Null). Erwartungswert Red/Black: -${((1/37)*100).toFixed(2)}% pro Einsatz.`;
  rNote.textContent = theor;
  result.classList.add('show');
}

function endSim() {
  running=false;
  if (timer) clearInterval(timer);
  btnStart.disabled=false; btnStop.disabled=true;
  showResult();
}

// ── MULTI-BATCH ──────────────────────────────────────────────────────────────
function runBatch(n) {
  const budget = +selBudget.value;
  const spins  = +selSpins.value;
  // Accumulate per-system stats
  const acc = {};
  SYS.forEach(s=>acc[s]={pnlSum:0, betsSum:0, winsSum:0, busts:0, best:-Infinity, worst:Infinity});

  for (let run=0;run<n;run++) {
    const sts = SYS.map(s=>mkState(budget,s));
    const hist = [], nh = [];
    for (let i=0;i<spins;i++) {
      const num=spin(), c=colorOf(num);
      hist.unshift(c); if(hist.length>25)hist.pop();
      nh.unshift(num); if(nh.length>25)nh.pop();
      const pats=analyze(hist);
      const doz=dozAbsence(nh);
      sts.forEach(S=>tick(S,num,pats,doz));
    }
    sts.forEach(S=>{
      acc[S.sys].pnlSum  += S.pnl;
      acc[S.sys].betsSum += S.bets;
      acc[S.sys].winsSum += S.wins;
      if (S.busted) acc[S.sys].busts++;
      if (S.pnl > acc[S.sys].best)  acc[S.sys].best  = S.pnl;
      if (S.pnl < acc[S.sys].worst) acc[S.sys].worst = S.pnl;
    });
  }

  const rows = SYS.map(s=>{
    const a=acc[s];
    const avgPnl=(a.pnlSum/n).toFixed(2);
    const avgBets=(a.betsSum/n).toFixed(0);
    const avgWr=(a.winsSum/a.betsSum*100).toFixed(1);
    const bustRate=((a.busts/n)*100).toFixed(0);
    const pC=+avgPnl>0?'g':+avgPnl<0?'r':'z';
    const badge = a.busts===n?'<span class="badge badge-bust">bust always</span>':'';
    return `<tr>
      <td><b>${SYS_LABEL[s]}</b>${badge}</td>
      <td class="${pC}">${+avgPnl>=0?'+':''}${avgPnl} CHF</td>
      <td>${avgBets}</td>
      <td>${avgWr}%</td>
      <td class="${+bustRate>50?'r':+bustRate>20?'z':'g'}">${bustRate}%</td>
      <td class="g">+${a.best.toFixed(2)}</td>
      <td class="r">${a.worst.toFixed(2)}</td>
    </tr>`;
  }).join('');

  multiTbody.innerHTML = rows;
  multiResult.classList.add('show');

  // Show best system by avg P&L
  const best = SYS.reduce((a,b)=>acc[b].pnlSum>acc[a].pnlSum?b:a);
  rTitle.textContent = `📊 ${n}× Batch (${spins} Spins, ${budget} CHF Budget) — Ø bestes: ${SYS_LABEL[best]}`;
  rGrid.innerHTML = SYS.map(s=>{
    const a=acc[s];
    const ap=(a.pnlSum/n); const pC=ap>0?'g':ap<0?'r':'z';
    return `<div class="result-box">
      <div class="result-sys">${SYS_LABEL[s]}</div>
      <div class="result-pnl ${pC}">${ap>=0?'+':''}${ap.toFixed(2)} CHF Ø</div>
      <div class="result-detail">Bust: ${((a.busts/n)*100).toFixed(0)}% der Läufe</div>
    </div>`;
  }).join('');
  rNote.textContent = `Statistik über ${n} unabhängige Läufe. Haus-Vorteil: ${((1/37)*100).toFixed(2)}% pro Wette → langfristig verliert jede Strategie.`;
  result.classList.add('show');
}

// ── CONTROLS ─────────────────────────────────────────────────────────────────
const btnStart  = document.getElementById('btnStart');
const btnStop   = document.getElementById('btnStop');
const btnReset  = document.getElementById('btnReset');
const btnMulti  = document.getElementById('btnMulti');
const selBudget = document.getElementById('selBudget');
const selSpins  = document.getElementById('selSpins');
const selSpeed  = document.getElementById('selSpeed');
const spinCircle= document.getElementById('spinCircle');
const spinCounter=document.getElementById('spinCounter');
const historyEl = document.getElementById('history');
const tbody     = document.getElementById('tbody');
const result    = document.getElementById('result');
const multiResult=document.getElementById('multiResult');
const multiTbody= document.getElementById('multiTbody');
const rTitle    = document.getElementById('rTitle');
const rGrid     = document.getElementById('rGrid');
const rNote     = document.getElementById('rNote');

btnStart.addEventListener('click', ()=>{
  initSim();
  running=true; btnStart.disabled=true; btnStop.disabled=false;
  const speed = +selSpeed.value;
  if (speed===0) {
    while (running && spinNo<maxSpins) {
      doOneSpin();
    }
    renderAll(undefined, undefined, analyze(history));
    endSim();
  } else {
    timer = setInterval(()=>{
      if (!running||spinNo>=maxSpins){endSim();return;}
      const {num,c,pats}=doOneSpin();
      renderAll(num,c,pats);
    }, speed);
  }
});

btnStop.addEventListener('click', ()=>{
  running=false; if(timer)clearInterval(timer);
  btnStart.disabled=false; btnStop.disabled=true;
});

btnReset.addEventListener('click', ()=>{
  running=false; if(timer)clearInterval(timer);
  btnStart.disabled=false; btnStop.disabled=true;
  initSim();
});

btnMulti.addEventListener('click', ()=>{
  running=false; if(timer)clearInterval(timer);
  btnStart.disabled=false; btnStop.disabled=true;
  btnMulti.disabled=true; btnMulti.textContent='⏳ rechne…';
  setTimeout(()=>{ runBatch(100); btnMulti.disabled=false; btnMulti.textContent='📊 100× Batch'; }, 20);
});

initSim();
