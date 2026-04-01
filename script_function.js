// ─── GLOBALS ────────────────────────────────────────────────────────────────
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

let W, H;
function resize(){
  W = canvas.width = window.innerWidth;
  H = canvas.height = window.innerHeight;
}
resize();
window.addEventListener('resize', resize);

const ELEMENTS = [
  {name:'FIRE',icon:'🔥',color:'#ff4d00',glow:'rgba(255,77,0,0.6)',cls:'active-fire',label:'🔥 FIRE',cssVar:'--fire'},
  {name:'ICE', icon:'❄️',color:'#00cfff',glow:'rgba(0,207,255,0.6)',cls:'active-ice',label:'❄️ ICE',cssVar:'--ice'},
  {name:'ELEC',icon:'⚡',color:'#ffe600',glow:'rgba(255,230,0,0.6)',cls:'active-elec',label:'⚡ ELECTRIC',cssVar:'--elec'},
];
const ELEM_BTNS = ['btn-fire','btn-ice','btn-elec'];
          
// Game state
let state = 'start';
let score=0, wave=1, hp=100, maxHp=100;
let currentElem=0;
let bullets=[], enemies=[], particles=[], floatingTexts=[];
let shootCooldown=0, invincible=0;
let shakeX=0, shakeY=0, shakeMag=0;
let gameRunning=false;
let isPaused=false;
let autosaveTick=0;
const SAVE_KEY='elemental_shooter_state_v1';

// Wave spawns are staggered; only treat wave as done when all spawns finished + all dead.
let waveSpawnGeneration=0;
let waveSpawnsTotal=0;
let waveSpawnsDone=0;
let upgradePanelTimerId=null;

// Settings / music
const settingsModal = document.getElementById('settings-modal');
const musicVolumeInput = document.getElementById('music-volume');
const musicVolumeVal = document.getElementById('music-volume-val');
let audioCtx=null, musicMasterGain=null, musicOscA=null, musicOscB=null, musicLfo=null, musicLfoGain=null;
let musicVolume = Number(musicVolumeInput?.value || 35)/100;

function saveGameState(){
  if(!gameRunning) return;
  const snapshot = {
    score, wave, hp, maxHp, currentElem,
    bullets, enemies, particles, floatingTexts, lightnings,
    shootCooldown, invincible, shakeX, shakeY, shakeMag,
    state,
    waveSpawnsTotal, waveSpawnsDone,
    player: {...player},
    upgrades: {...upgrades},
  };
  try{
    sessionStorage.setItem(SAVE_KEY, JSON.stringify(snapshot));
  }catch(_err){}
}

function clearSavedGameState(){
  try{
    sessionStorage.removeItem(SAVE_KEY);
  }catch(_err){}
}

function restoreGameState(){
  let raw='';
  try{
    raw = sessionStorage.getItem(SAVE_KEY) || '';
  }catch(_err){
    return false;
  }
  if(!raw) return false;

  let data=null;
  try{
    data = JSON.parse(raw);
  }catch(_err){
    return false;
  }
  if(!data || !data.player || !data.upgrades) return false;

  score = data.score ?? 0;
  wave = data.wave ?? 1;
  hp = data.hp ?? 100;
  maxHp = data.maxHp ?? 100;
  currentElem = data.currentElem ?? 0;

  bullets = Array.isArray(data.bullets) ? data.bullets : [];
  enemies = Array.isArray(data.enemies) ? data.enemies : [];
  particles = Array.isArray(data.particles) ? data.particles : [];
  floatingTexts = Array.isArray(data.floatingTexts) ? data.floatingTexts : [];

  lightnings.length = 0;
  if(Array.isArray(data.lightnings)) lightnings.push(...data.lightnings);

  shootCooldown = data.shootCooldown ?? 0;
  invincible = data.invincible ?? 0;
  shakeX = data.shakeX ?? 0;
  shakeY = data.shakeY ?? 0;
  shakeMag = data.shakeMag ?? 0;

  const expectedSpawns = 3 + wave * 2;
  waveSpawnsTotal = data.waveSpawnsTotal ?? expectedSpawns;
  waveSpawnsDone =
    data.waveSpawnsDone != null ? data.waveSpawnsDone : expectedSpawns;

  Object.assign(player, data.player);
  Object.assign(upgrades, data.upgrades);

  document.getElementById('screen-start').style.display='none';
  document.getElementById('screen-gameover').style.display='none';
  document.getElementById('upgrade-panel').classList.remove('show');

  state = data.state === 'upgrade' ? 'upgrade' : 'playing';
  gameRunning = true;
  isPaused = false;
  setElement(Math.max(0, Math.min(2, currentElem)));
  updateHUD();

  if(state==='upgrade'){
    showUpgradePanel();
  }
  return true;
}

// Player
const player = {x:0,y:0,w:28,h:28,vx:0,vy:0,speed:4};

// Upgrades
const upgrades = {
  burnDur:3, freezeDur:90, chainCount:2,
  dmg:1, atkSpeed:1, bulletSize:1
};

// Input
const keys={};
const mouse={x:0,y:0,down:false};
let joystick={active:false,startX:0,startY:0,dx:0,dy:0};
let mobileFireActive=false;
let mobileFireInterval=null;

// ─── ELEMENT UI ──────────────────────────────────────────────────────────────
function setElement(i){
  currentElem=i;
  ELEM_BTNS.forEach((id,j)=>{
    const b=document.getElementById(id);
    b.className='elem-btn'+(j===i?' '+ELEMENTS[i].cls:'');
  });
  const el=ELEMENTS[i];
  document.getElementById('elem-label').textContent=el.label;
  document.getElementById('elem-label').style.color=el.color;
  if(document.getElementById('fire-btn')) document.getElementById('fire-btn').textContent=el.icon;
}

// ─── GAME FLOW ───────────────────────────────────────────────────────────────
function startGame(){
  clearTimeout(upgradePanelTimerId);
  upgradePanelTimerId=null;
  document.getElementById('screen-start').style.display='none';
  document.getElementById('screen-gameover').style.display='none';
  closeSettings(false);
  score=0; wave=1; hp=100; maxHp=100;
  bullets=[]; enemies=[]; particles=[]; floatingTexts=[];
  Object.assign(upgrades,{burnDur:3,freezeDur:90,chainCount:2,dmg:1,atkSpeed:1,bulletSize:1});
  player.x=W/2; player.y=H/2;
  player.vx=0; player.vy=0;
  setElement(0);
  updateHUD();
  gameRunning=true;
  isPaused=false;
  state='playing';
  clearSavedGameState();
  saveGameState();
  initBackgroundMusic();
  spawnWave();
}

function gameOver(){
  clearTimeout(upgradePanelTimerId);
  upgradePanelTimerId=null;
  gameRunning=false;
  isPaused=false;
  state='gameover';
  closeSettings(false);
  clearSavedGameState();
  document.getElementById('go-score').textContent=score;
  document.getElementById('go-wave').textContent='WAVE '+wave;
  document.getElementById('screen-gameover').style.display='flex';
}

function updateHUD(){
  document.getElementById('hp-val').textContent=Math.max(0,Math.ceil(hp));
  document.getElementById('hp-bar').style.width=(hp/maxHp*100)+'%';
  document.getElementById('score-val').textContent=score;
  document.getElementById('wave-val').textContent=wave;
}

function announceWave(n){
  const el=document.getElementById('wave-announce');
  el.textContent='WAVE '+n;
  el.className='show';
  setTimeout(()=>el.className='',1800);
}

function showCombo(text,color){
  const el=document.getElementById('combo-flash');
  el.textContent=text;
  el.style.color=color;
  el.style.opacity='1';
  el.style.textShadow=`0 0 20px ${color}`;
  clearTimeout(el._t);
  el._t=setTimeout(()=>el.style.opacity='0',1200);
}

// ─── SPAWN ────────────────────────────────────────────────────────────────────
function spawnWave(){
  announceWave(wave);
  const count=3+wave*2;
  waveSpawnsTotal=count;
  waveSpawnsDone=0;
  waveSpawnGeneration++;
  const gen=waveSpawnGeneration;
  const types=['basic','fast','tank','shield','resist'];
  for(let i=0;i<count;i++){
    setTimeout(()=>{
      if(gen!==waveSpawnGeneration)return;
      spawnEnemy(types,i);
      waveSpawnsDone++;
    },i*300);
  }
}

function spawnEnemy(types,i){
  let type='basic';
  if(wave>=2&&Math.random()<0.25)type='fast';
  if(wave>=3&&Math.random()<0.2)type='tank';
  if(wave>=4&&Math.random()<0.15)type='shield';
  if(wave>=5&&Math.random()<0.1)type='resist';

  const side=Math.floor(Math.random()*4);
  let x,y;
  if(side===0){x=Math.random()*W;y=-30}
  else if(side===1){x=W+30;y=Math.random()*H}
  else if(side===2){x=Math.random()*W;y=H+30}
  else{x=-30;y=Math.random()*H}

  const templates={
    basic:{hp:60,speed:1.2,size:18,color:'#888',score:10},
    fast:{hp:30,speed:2.4,size:13,color:'#b0e0ff',score:15},
    tank:{hp:200,speed:0.7,size:28,color:'#7a5c3a',score:30},
    shield:{hp:80,speed:1.0,size:20,color:'#5588ff',score:25,shield:true},
    resist:{hp:90,speed:1.3,size:18,color:'#ff5588',score:20,iceResist:true},
  };
  const t=templates[type];
  enemies.push({
    x,y,type,
    hp:t.hp*(1+wave*0.15), maxHp:t.hp*(1+wave*0.15),
    speed:t.speed*(1+wave*0.05),
    size:t.size, color:t.color, score:t.score,
    shield:t.shield||false, iceResist:t.iceResist||false,
    burning:0, burnTimer:0,
    frozen:0, slowMult:1,
    shieldCooldown:0,
    flashTimer:0,
  });
}

// ─── SHOOTING ─────────────────────────────────────────────────────────────────
function shoot(tx,ty){
  const dx=tx-player.x, dy=ty-player.y;
  const dist=Math.sqrt(dx*dx+dy*dy)||1;
  const speed=9;
  const el=ELEMENTS[currentElem];
  const size=(6+upgrades.bulletSize*2)*1;
  bullets.push({
    x:player.x, y:player.y,
    vx:dx/dist*speed, vy:dy/dist*speed,
    elem:currentElem, color:el.color, glow:el.glow,
    size, life:60, dmg:18*upgrades.dmg,
    trail:[],
  });
}

// ─── UPDATE ───────────────────────────────────────────────────────────────────
function update(){
  if(!gameRunning || isPaused)return;

  // Screen shake decay
  shakeMag*=0.85;
  shakeX=(Math.random()-0.5)*shakeMag;
  shakeY=(Math.random()-0.5)*shakeMag;

  // Player movement
  let mx=0,my=0;
  if(keys['ArrowLeft']||keys['KeyA']||keys['a'])mx=-1;
  if(keys['ArrowRight']||keys['KeyD']||keys['d'])mx=1;
  if(keys['ArrowUp']||keys['KeyW']||keys['w'])my=-1;
  if(keys['ArrowDown']||keys['KeyS']||keys['s'])my=1;

  // Joystick override
  if(joystick.active){
    mx=joystick.dx;my=joystick.dy;
  }

  if(mx||my){
    const len=Math.sqrt(mx*mx+my*my)||1;
    player.vx=mx/len*player.speed;
    player.vy=my/len*player.speed;
  }else{
    player.vx*=0.8; player.vy*=0.8;
  }
  player.x=Math.max(14,Math.min(W-14,player.x+player.vx));
  player.y=Math.max(14,Math.min(H-14,player.y+player.vy));

  // Auto-aim on mobile fire
  if(mobileFireActive){
    // aim at nearest enemy
    let nearest=null,nd=99999;
    enemies.forEach(e=>{const d=dist2(player,e);if(d<nd){nd=d;nearest=e;}});
    if(nearest&&shootCooldown<=0){
      shoot(nearest.x,nearest.y);
      shootCooldown=Math.max(8,18/upgrades.atkSpeed);
    }
  }

  // Shoot cooldown
  if(shootCooldown>0)shootCooldown--;
  if(mouse.down&&shootCooldown<=0){
    shoot(mouse.x,mouse.y);
    shootCooldown=Math.max(8,18/upgrades.atkSpeed);
  }

  // Invincibility
  if(invincible>0)invincible--;

  // Bullets
  bullets=bullets.filter(b=>{
    b.trail.push({x:b.x,y:b.y});
    if(b.trail.length>8)b.trail.shift();
    b.x+=b.vx; b.y+=b.vy; b.life--;
    if(b.x<0||b.x>W||b.y<0||b.y>H||b.life<=0)return false;

    // Hit enemies
    for(let i=enemies.length-1;i>=0;i--){
      const e=enemies[i];
      const d=Math.sqrt((b.x-e.x)**2+(b.y-e.y)**2);
      if(d<e.size+b.size){
        hitEnemy(e,b,i);
        return false;
      }
    }
    return true;
  });

  // Enemies
  enemies.forEach((e,i)=>{
    // Move toward player
    const dx=player.x-e.x, dy=player.y-e.y;
    const d=Math.sqrt(dx*dx+dy*dy)||1;
    const spd=e.frozen>0?0:e.speed*(e.slowMult||1);
    e.x+=dx/d*spd; e.y+=dy/d*spd;

    // Shield recharge
    if(e.shield&&e.shieldCooldown>0)e.shieldCooldown--;
    if(e.shield&&e.shieldCooldown<=0)e.shield=true;

    // Burn DoT
    if(e.burning>0){
      e.burnTimer--;
      if(e.burnTimer<=0){
        e.hp-=3*upgrades.dmg;
        e.burnTimer=20;
        e.burning--;
        spawnParticle(e.x,e.y,'#ff6600',3,15);
      }
    }

    // Freeze countdown
    if(e.frozen>0){e.frozen--;}else{e.slowMult=1;}

    // Flash
    if(e.flashTimer>0)e.flashTimer--;

    // Contact damage
    if(d<e.size+player.w/2&&invincible<=0){
      hp-=8;
      invincible=60;
      shakeMag=12;
      updateHUD();
      spawnParticle(player.x,player.y,'#ff2d55',8,20);
      if(hp<=0){gameOver();return;}
    }
  });

  // Remove dead enemies
  const before=enemies.length;
  enemies=enemies.filter(e=>e.hp>0);
  const killed=before-enemies.length;
  if(killed>0)updateHUD();

  // Wave clear: all enemies dead AND every spawn for this wave has finished (no late timers)
  if(
    enemies.length===0 &&
    waveSpawnsDone>=waveSpawnsTotal &&
    waveSpawnsTotal>0 &&
    gameRunning &&
    state==='playing'
  ){
    state='upgrade';
    clearTimeout(upgradePanelTimerId);
    upgradePanelTimerId=setTimeout(()=>{
      upgradePanelTimerId=null;
      showUpgradePanel();
    },800);
  }

  // Particles
  particles=particles.filter(p=>{
    p.x+=p.vx; p.y+=p.vy; p.life--; p.vx*=0.95; p.vy*=0.95;
    return p.life>0;
  });

  // Floating texts
  floatingTexts=floatingTexts.filter(t=>{
    t.y-=1.2; t.life--; t.alpha=t.life/t.maxLife;
    return t.life>0;
  });

  autosaveTick++;
  if(autosaveTick>=30){
    autosaveTick=0;
    saveGameState();
  }
}

function hitEnemy(e,b,idx){
  let dmg=b.dmg;
  const elem=b.elem;

  // Shield blocks from front
  if(e.shield&&e.shieldCooldown<=0){
    const dx=player.x-e.x;
    const facingPlayer=dx>0; // shield on left side (toward player)
    if(facingPlayer){
      e.shieldCooldown=120;
      spawnParticle(b.x,b.y,'#88aaff',6,18);
      showCombo('SHIELD BLOCK','#5588ff');
      return;
    }
  }

  let comboText='',comboColor='';

  if(elem===0){
    // Fire
    if(e.frozen>0){
      // Melt burst combo
      dmg*=2.5;
      e.frozen=0;
      comboText='MELT BURST!'; comboColor='#ff9900';
      shakeMag=10;
    }
    e.burning=Math.min(e.burning+upgrades.burnDur,9);
    e.burnTimer=20;
    spawnParticle(b.x,b.y,'#ff4d00',6,20);
  }else if(elem===1){
    // Ice
    if(e.iceResist){
      dmg*=0.5;
      spawnParticle(b.x,b.y,'#aaaaff',4,12);
      showCombo('RESISTANT!','#ff5588');
    }else{
      e.slowMult=0.35;
      e.frozen=upgrades.freezeDur*60;
      if(e.burning>0){
        // Explosion if was burning (electric + fire already applied)
        // Here we do freeze burst for ice
        comboText='FROZEN!'; comboColor='#00cfff';
      }
      spawnParticle(b.x,b.y,'#00cfff',6,20);
    }
  }else{
    // Electric - chain
    spawnParticle(b.x,b.y,'#ffe600',5,18);
    let chains=upgrades.chainCount;
    let lastTarget=e;
    let chainDmg=dmg*0.6;
    for(let c=0;c<chains;c++){
      let closest=null,cd=99999;
      enemies.forEach(en=>{
        if(en===lastTarget||en===e)return;
        const dd=dist2(lastTarget,en);
        if(dd<cd){cd=dd;closest=en;}
      });
      if(closest&&cd<180*180){
        closest.hp-=chainDmg;
        closest.flashTimer=8;
        spawnLightning(lastTarget.x,lastTarget.y,closest.x,closest.y);
        spawnParticle(closest.x,closest.y,'#ffe600',4,15);
        lastTarget=closest;
        chainDmg*=0.6;
        if(chains===upgrades.chainCount&&upgrades.chainCount>1){
          comboText='CHAIN x'+upgrades.chainCount+'!'; comboColor='#ffe600';
        }
      }
    }
    // Fire+Electric = explosion
    if(e.burning>0){
      dmg*=2;
      e.burning=0;
      shakeMag=14;
      for(let i=0;i<12;i++)spawnParticle(e.x,e.y,'#ff6600',5,25);
      comboText='EXPLOSION!'; comboColor='#ff9900';
    }
  }

  e.hp-=dmg;
  e.flashTimer=6;
  shakeMag=Math.max(shakeMag,4);
  spawnFloatingText(e.x,e.y-e.size,'-'+Math.ceil(dmg),ELEMENTS[elem].color);

  if(comboText)showCombo(comboText,comboColor);

  if(e.hp<=0){
    score+=e.score*(1+Math.floor(wave/3));
    for(let i=0;i<8;i++)spawnParticle(e.x,e.y,e.color,4+(Math.random()*4),25+(Math.random()*20));
    shakeMag=Math.max(shakeMag,6);
    updateHUD();
  }
}

function dist2(a,b){return (a.x-b.x)**2+(a.y-b.y)**2;}

// ─── PARTICLES & EFFECTS ─────────────────────────────────────────────────────
function spawnParticle(x,y,color,count,life){
  for(let i=0;i<count;i++){
    const a=Math.random()*Math.PI*2;
    const spd=1+Math.random()*3;
    particles.push({x,y,vx:Math.cos(a)*spd,vy:Math.sin(a)*spd,life,maxLife:life,color,size:2+Math.random()*3});
  }
}

const lightnings=[];
function spawnLightning(x1,y1,x2,y2){
  lightnings.push({x1,y1,x2,y2,life:8,alpha:1});
}

function spawnFloatingText(x,y,text,color){
  floatingTexts.push({x,y,text,color,life:50,maxLife:50,alpha:1});
}

// ─── DRAW ─────────────────────────────────────────────────────────────────────
function draw(){
  ctx.save();
  ctx.clearRect(0,0,W,H);

  // Background
  ctx.fillStyle='#0a0a0f';
  ctx.fillRect(0,0,W,H);

  // Grid
  ctx.strokeStyle='rgba(255,255,255,0.03)';
  ctx.lineWidth=1;
  const gridSize=60;
  for(let x=0;x<W;x+=gridSize){
    ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke();
  }
  for(let y=0;y<H;y+=gridSize){
    ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke();
  }

  // Apply shake
  ctx.translate(shakeX,shakeY);

  // Draw lightnings
  lightnings.forEach((l,i)=>{
    l.life--;
    l.alpha=l.life/8;
    if(l.life<=0){lightnings.splice(i,1);return;}
    ctx.save();
    ctx.globalAlpha=l.alpha;
    ctx.strokeStyle='#ffe600';
    ctx.lineWidth=2;
    ctx.shadowColor='#ffe600';
    ctx.shadowBlur=8;
    ctx.beginPath();
    // Jagged lightning
    const segs=6;
    let px=l.x1,py=l.y1;
    const ddx=(l.x2-l.x1)/segs, ddy=(l.y2-l.y1)/segs;
    ctx.moveTo(px,py);
    for(let s=1;s<=segs;s++){
      const tx=l.x1+ddx*s+(s<segs?(Math.random()-0.5)*20:0);
      const ty=l.y1+ddy*s+(s<segs?(Math.random()-0.5)*20:0);
      ctx.lineTo(tx,ty);
    }
    ctx.stroke();
    ctx.restore();
  });

  // Particles
  particles.forEach(p=>{
    const a=p.life/p.maxLife;
    ctx.save();
    ctx.globalAlpha=a;
    ctx.fillStyle=p.color;
    ctx.shadowColor=p.color;
    ctx.shadowBlur=6;
    ctx.beginPath();
    ctx.arc(p.x,p.y,p.size*a,0,Math.PI*2);
    ctx.fill();
    ctx.restore();
  });

  // Bullets
  bullets.forEach(b=>{
    // Trail
    b.trail.forEach((t,ti)=>{
      const a=(ti/b.trail.length)*0.4;
      ctx.save();
      ctx.globalAlpha=a;
      ctx.fillStyle=b.color;
      ctx.beginPath();
      ctx.arc(t.x,t.y,b.size*0.5,0,Math.PI*2);
      ctx.fill();
      ctx.restore();
    });
    // Bullet
    ctx.save();
    ctx.shadowColor=b.glow;
    ctx.shadowBlur=16;
    ctx.fillStyle=b.color;
    ctx.beginPath();
    ctx.arc(b.x,b.y,b.size,0,Math.PI*2);
    ctx.fill();
    // Inner bright
    ctx.fillStyle='#ffffff';
    ctx.beginPath();
    ctx.arc(b.x,b.y,b.size*0.4,0,Math.PI*2);
    ctx.fill();
    ctx.restore();
  });

  // Enemies
  enemies.forEach(e=>{
    ctx.save();
    const flash=e.flashTimer>0;
    ctx.shadowColor=e.color;
    ctx.shadowBlur=flash?30:10;

    // Freeze overlay
    if(e.frozen>0){
      ctx.shadowColor='#00cfff';
      ctx.shadowBlur=20;
    }

    ctx.fillStyle=flash?'#ffffff':(e.frozen>0?'#aaddff':e.color);

    // Shape by type
    if(e.type==='tank'){
      // Hexagon
      drawHex(e.x,e.y,e.size);
    }else if(e.type==='shield'){
      drawDiamond(e.x,e.y,e.size);
    }else{
      ctx.beginPath();
      ctx.arc(e.x,e.y,e.size,0,Math.PI*2);
      ctx.fill();
    }
    ctx.fill();

    // Burn flame effect
    if(e.burning>0){
      ctx.globalAlpha=0.6;
      ctx.fillStyle='#ff6600';
      ctx.beginPath();
      ctx.arc(e.x,e.y-e.size*0.6,e.size*0.5,0,Math.PI*2);
      ctx.fill();
      ctx.globalAlpha=1;
    }

    // Freeze crystal overlay
    if(e.frozen>0){
      ctx.globalAlpha=0.3;
      ctx.fillStyle='#00cfff';
      ctx.beginPath();
      ctx.arc(e.x,e.y,e.size*1.15,0,Math.PI*2);
      ctx.fill();
      ctx.globalAlpha=1;
    }

    // HP bar
    if(e.hp<e.maxHp){
      const bw=e.size*2;
      const bx=e.x-e.size;
      const by=e.y-e.size-10;
      ctx.fillStyle='rgba(0,0,0,0.5)';
      ctx.fillRect(bx,by,bw,5);
      ctx.fillStyle=e.hp/e.maxHp>0.5?'#44ff88':'#ff4444';
      ctx.fillRect(bx,by,bw*(e.hp/e.maxHp),5);
    }

    // Shield indicator
    if(e.shield&&e.shieldCooldown<=0){
      ctx.globalAlpha=0.5;
      ctx.strokeStyle='#88aaff';
      ctx.lineWidth=3;
      ctx.beginPath();
      ctx.arc(e.x,e.y,e.size+6,Math.PI*0.75,Math.PI*1.25);
      ctx.stroke();
      ctx.globalAlpha=1;
    }

    ctx.restore();
  });

  // Player
  ctx.save();
  const el=ELEMENTS[currentElem];
  ctx.shadowColor=el.glow;
  ctx.shadowBlur=20;
  // Body
  ctx.fillStyle=invincible>0&&Math.floor(invincible/4)%2?'rgba(255,255,255,0.3)':el.color;
  ctx.beginPath();
  ctx.arc(player.x,player.y,14,0,Math.PI*2);
  ctx.fill();
  // Core
  ctx.fillStyle='#ffffff';
  ctx.beginPath();
  ctx.arc(player.x,player.y,6,0,Math.PI*2);
  ctx.fill();
  // Aim line toward mouse
  if(mouse.x&&!mobileFireActive){
    const dx=mouse.x-player.x, dy=mouse.y-player.y;
    const d=Math.sqrt(dx*dx+dy*dy)||1;
    ctx.globalAlpha=0.4;
    ctx.strokeStyle=el.color;
    ctx.lineWidth=1.5;
    ctx.setLineDash([4,6]);
    ctx.beginPath();
    ctx.moveTo(player.x+dx/d*16,player.y+dy/d*16);
    ctx.lineTo(player.x+dx/d*50,player.y+dy/d*50);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();

  // Floating texts
  floatingTexts.forEach(t=>{
    ctx.save();
    ctx.globalAlpha=t.alpha;
    ctx.fillStyle=t.color;
    ctx.font='bold 14px Orbitron, monospace';
    ctx.textAlign='center';
    ctx.shadowColor=t.color;
    ctx.shadowBlur=8;
    ctx.fillText(t.text,t.x,t.y);
    ctx.restore();
  });

  ctx.restore();
}

function drawHex(x,y,r){
  ctx.beginPath();
  for(let i=0;i<6;i++){
    const a=Math.PI/180*60*i-Math.PI/2;
    ctx[i?'lineTo':'moveTo'](x+r*Math.cos(a),y+r*Math.sin(a));
  }
  ctx.closePath();
}
function drawDiamond(x,y,r){
  ctx.beginPath();
  ctx.moveTo(x,y-r);
  ctx.lineTo(x+r,y);
  ctx.lineTo(x,y+r);
  ctx.lineTo(x-r,y);
  ctx.closePath();
}

// ─── UPGRADES ────────────────────────────────────────────────────────────────
const upgradePool=[
  {id:'dmg',label:'Damage Up',desc:'All bullets deal more damage',icon:'💥',apply:()=>{upgrades.dmg+=0.25}},
  {id:'atkSpeed',label:'Attack Speed',desc:'Fire faster',icon:'⚡',apply:()=>{upgrades.atkSpeed+=0.3}},
  {id:'bulletSize',label:'Bullet Size',desc:'Larger bullets, more impact',icon:'🔵',apply:()=>{upgrades.bulletSize+=0.4}},
  {id:'burnDur',label:'Burn Duration',desc:'Fire burns longer',icon:'🔥',apply:()=>{upgrades.burnDur+=1}},
  {id:'freezeDur',label:'Freeze Duration',desc:'Ice freezes longer',icon:'❄️',apply:()=>{upgrades.freezeDur+=0.5}},
  {id:'chainCount',label:'Chain Count',desc:'Electric chains more targets',icon:'⛓️',apply:()=>{upgrades.chainCount+=1}},
  {id:'maxHp',label:'Max Health',desc:'Increase max HP',icon:'❤️',apply:()=>{maxHp+=20;hp=Math.min(hp+20,maxHp)}},
  {id:'hpRegen',label:'Restore HP',desc:'Heal 30 HP now',icon:'💚',apply:()=>{hp=Math.min(hp+30,maxHp)}},
];

function showUpgradePanel(){
  const panel=document.getElementById('upgrade-panel');
  if(panel.classList.contains('show'))return;
  isPaused = true;
  const container=document.getElementById('upgrade-cards');
  container.innerHTML='';
  // Pick 3 random upgrades
  const pool=[...upgradePool].sort(()=>Math.random()-0.5).slice(0,3);
  pool.forEach(u=>{
    const div=document.createElement('div');
    div.className='upgrade-card';
    div.innerHTML=`<div style="font-size:32px;margin-bottom:8px">${u.icon}</div>
      <div class="orbitron text-white font-bold text-sm mb-2">${u.label}</div>
      <div class="text-white opacity-50 text-xs">${u.desc}</div>`;
    div.onclick=()=>{u.apply();applyUpgrade();};
    container.appendChild(div);
  });
  panel.classList.add('show');
}

function applyUpgrade(){
  clearTimeout(upgradePanelTimerId);
  upgradePanelTimerId=null;
  document.getElementById('upgrade-panel').classList.remove('show');
  wave++;
  updateHUD();
  state='playing';
  isPaused = false;
  saveGameState();
  spawnWave();
}

function initBackgroundMusic(){
  if(!window.AudioContext && !window.webkitAudioContext) return;
  if(!audioCtx){
    const Ctx = window.AudioContext || window.webkitAudioContext;
    audioCtx = new Ctx();
    musicMasterGain = audioCtx.createGain();
    musicMasterGain.gain.value = musicVolume * 0.08;
    musicMasterGain.connect(audioCtx.destination);

    musicOscA = audioCtx.createOscillator();
    musicOscA.type = 'triangle';
    musicOscA.frequency.value = 110;
    musicOscA.connect(musicMasterGain);

    musicOscB = audioCtx.createOscillator();
    musicOscB.type = 'sine';
    musicOscB.frequency.value = 165;
    musicOscB.connect(musicMasterGain);

    musicLfo = audioCtx.createOscillator();
    musicLfo.type = 'sine';
    musicLfo.frequency.value = 0.15;
    musicLfoGain = audioCtx.createGain();
    musicLfoGain.gain.value = 12;
    musicLfo.connect(musicLfoGain);
    musicLfoGain.connect(musicOscB.frequency);

    musicOscA.start();
    musicOscB.start();
    musicLfo.start();
  }
  if(audioCtx.state === 'suspended') audioCtx.resume();
}

function setMusicVolume(value){
  musicVolume = Math.max(0, Math.min(1, value/100));
  if(musicMasterGain){
    musicMasterGain.gain.value = musicVolume * 0.08;
  }
  if(musicVolumeVal){
    musicVolumeVal.textContent = Math.round(musicVolume*100)+'%';
  }
}

function openSettings(){
  settingsModal.classList.add('show');
  if(state==='playing' && gameRunning){
    isPaused = true;
  }
}

function closeSettings(shouldResume=true){
  settingsModal.classList.remove('show');
  if(shouldResume && state==='playing' && gameRunning){
    isPaused = false;
  }
}

function resumeFromSettings(){
  closeSettings(true);
}

function exitFromSettings(){
  closeSettings(false);
  isPaused = false;
  gameRunning = false;
  state = 'start';
  clearSavedGameState();
  bullets=[]; enemies=[]; particles=[]; floatingTexts=[];
  document.getElementById('upgrade-panel').classList.remove('show');
  document.getElementById('screen-gameover').style.display='none';
  document.getElementById('screen-start').style.display='flex';
  mouse.down=false;
}

// ─── INPUT ────────────────────────────────────────────────────────────────────
window.addEventListener('keydown',e=>{
  keys[e.code]=true; keys[e.key]=true;
  if(e.code==='Escape'){
    if(settingsModal.classList.contains('show')) closeSettings(true);
    else openSettings();
  }
  if(e.key==='1')setElement(0);
  if(e.key==='2')setElement(1);
  if(e.key==='3')setElement(2);
});
window.addEventListener('keyup',e=>{keys[e.code]=false;keys[e.key]=false;});

canvas.addEventListener('mousemove',e=>{
  const r=canvas.getBoundingClientRect();
  mouse.x=e.clientX-r.left; mouse.y=e.clientY-r.top;
});
canvas.addEventListener('mousedown',e=>{
  if(e.button===0){mouse.down=true;mouse.x=e.clientX;mouse.y=e.clientY;}
});
canvas.addEventListener('mouseup',e=>{if(e.button===0)mouse.down=false;});

// Joystick
const jZone=document.getElementById('joystick-zone');
const jBase=document.getElementById('joystick-base');
const jThumb=document.getElementById('joystick-thumb');
const maxR=40;

function jStart(x,y){
  joystick.active=true;
  joystick.startX=x; joystick.startY=y;
  joystick.dx=0; joystick.dy=0;
}
function jMove(x,y){
  if(!joystick.active)return;
  let dx=x-joystick.startX, dy=y-joystick.startY;
  const d=Math.sqrt(dx*dx+dy*dy);
  if(d>maxR){dx=dx/d*maxR;dy=dy/d*maxR;}
  jThumb.style.left=(65+dx)+'px';
  jThumb.style.top=(65+dy)+'px';
  joystick.dx=dx/maxR; joystick.dy=dy/maxR;
}
function jEnd(){
  joystick.active=false; joystick.dx=0; joystick.dy=0;
  jThumb.style.left='50%'; jThumb.style.top='50%';
}

jZone.addEventListener('touchstart',e=>{e.preventDefault();const t=e.touches[0];jStart(t.clientX-jZone.getBoundingClientRect().left,t.clientY-jZone.getBoundingClientRect().top);},{passive:false});
jZone.addEventListener('touchmove',e=>{e.preventDefault();const t=e.touches[0];jMove(t.clientX-jZone.getBoundingClientRect().left,t.clientY-jZone.getBoundingClientRect().top);},{passive:false});
jZone.addEventListener('touchend',jEnd);

const fireBtn=document.getElementById('fire-btn');
fireBtn.addEventListener('touchstart',e=>{
  e.preventDefault();
  mobileFireActive=true;
});
fireBtn.addEventListener('touchend',e=>{
  e.preventDefault();
  mobileFireActive=false;
});

if(musicVolumeInput){
  setMusicVolume(Number(musicVolumeInput.value));
  musicVolumeInput.addEventListener('input',e=>{
    setMusicVolume(Number(e.target.value));
  });
}

// Always show settings after any browser refresh/reload.
if(restoreGameState()){
  openSettings();
}

// ─── DOWNLOAD: single-file “app” (CSS+JS inlined) + PWA when hosted ───────────
async function getPageHtmlForDownload(){
  try{
    const res=await fetch(location.href,{cache:'no-store'});
    const t=await res.text();
    if(t&&t.length>200)return t;
  }catch(_){}
  return '<!DOCTYPE html>\n'+document.documentElement.outerHTML;
}

async function fetchTextSafe(url){
  try{
    const res=await fetch(url,{cache:'no-store'});
    if(res.ok)return await res.text();
  }catch(_){}
  return '';
}

function escapeForInlineScript(js){
  return js.replace(/<\/script>/gi,'<\\/script>');
}

async function buildStandaloneAppHtml(){
  const base=await getPageHtmlForDownload();
  const cssUrl=new URL('sharp_shooter.css',location.href).href;
  const jsUrl=new URL('script_function.js',location.href).href;
  const [cssText,jsText]=await Promise.all([fetchTextSafe(cssUrl),fetchTextSafe(jsUrl)]);
  let html=base;
  if(cssText){
    html=html.replace(/<link[^>]*href=["'][^"']*sharp_shooter\.css["'][^>]*>/i,'<style>'+cssText+'</style>');
  }
  if(jsText){
    const inlined='<script>'+escapeForInlineScript(jsText)+'<\/script>';
    html=html.replace(/<script[^>]*src=["'][^"']*script_function\.js["'][^>]*>\s*<\/script>/i,inlined);
  }
  const note='<!-- Standalone bundle: open this file in Chrome/Safari on your phone, then use menu → Add to Home Screen / Install app. -->';
  if(html.includes('<head>')) html=html.replace('<head>','<head>\n'+note);
  return html;
}

function registerServiceWorker(){
  if(!('serviceWorker'in navigator))return;
  const secure=location.protocol==='https:'||location.hostname==='localhost'||location.hostname==='127.0.0.1';
  if(!secure)return;
  window.addEventListener('load',()=>{
    navigator.serviceWorker.register(new URL('sw.js',location.href).href,{scope:'./'}).catch(()=>{});
  });
}
registerServiceWorker();

async function downloadGame(ev){
  if(ev) ev.preventDefault();
  const filename='Elemental-Shooter-App.html';
  let html='';
  try{
    html=await buildStandaloneAppHtml();
  }catch(_){
    html=await getPageHtmlForDownload();
  }
  const blob=new Blob([html],{type:'text/html;charset=utf-8'});

  try{
    if(navigator.share&&navigator.canShare){
      const file=new File([blob],filename,{type:'text/html'});
      const data={files:[file],title:'Elemental Shooter',text:'Save and open on your phone, then Add to Home Screen to install.'};
      if(navigator.canShare(data)){
        await navigator.share(data);
        return;
      }
    }
  }catch(_){}

  try{
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url;
    a.download=filename;
    a.rel='noopener';
    document.body.appendChild(a);
    a.click();
    setTimeout(()=>{
      URL.revokeObjectURL(url);
      document.body.removeChild(a);
    },250);
  }catch(_){
    window.open(URL.createObjectURL(blob),'_blank','noopener');
  }
}

// ─── LOOP ─────────────────────────────────────────────────────────────────────
function loop(){
  update();
  draw();
  requestAnimationFrame(loop);
}
loop();
