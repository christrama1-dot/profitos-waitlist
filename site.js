/* ProfitOS Engine — shared site JS: watchdog ticker + OS logo animation (ported from legacy index, To-Do #55) */
(function(){
  /* ---- watchdog ticker ---- */
  var track=document.getElementById('ticker');
  if(track){
    var feed=[
      ['a','09:41','SubscriptionGuard','renewal above agreed rate — flagged'],
      ['g','09:52','WasteWatcher','unused seat on a paid tool — cancel steps sent'],
      ['c','10:07','CashFlowGuard','invoice past due — follow-up drafted'],
      ['a','10:31','Payment Pointer','possible duplicate charge — queued for review'],
      ['g','10:48','SubscriptionGuard','zombie subscription — confirmed cancelled'],
      ['r','11:15','WasteWatcher','vendor price drift — third increase in a row'],
      ['c','11:29','CashFlowGuard','deposit return window closing — reminder sent'],
      ['g','11:56','Payment Pointer','refund owed — claim steps delivered']
    ];
    var dot={g:'tk-g',a:'tk-k',c:'tk-c',r:'tk-r'};
    var lbl='<div class="tk-chip tk-lbl"><span class="tk-text">SIMULATED FEED · LAUNCH CORE WATCHDOGS</span></div>';
    var half=lbl+feed.map(function(f){return '<div class="tk-chip"><span class="tk-dot '+dot[f[0]]+'"></span><span class="tk-time">'+f[1]+'</span><span class="tk-name">'+f[2]+'</span><span class="tk-text">'+f[3]+'</span></div>';}).join('');
    track.innerHTML=half+half;
  }

  /* ---- audience band: fit text to one justified line ---- */
  var ab=document.querySelector('.audience-band');
  if(ab){
    var abFit=function(){
      ab.style.fontSize='';
      var fs=parseFloat(getComputedStyle(ab).fontSize),guard=0;
      while(ab.scrollWidth>ab.clientWidth+1&&guard<40){fs*=0.96;ab.style.fontSize=fs+'px';guard++}
    };
    abFit();window.addEventListener('resize',abFit);
  }

  /* ---- OS logo fly animation ---- */
  if(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  if(window.innerWidth<=600)return;
  var logoEm=document.getElementById('logo-em');
  var fly=document.getElementById('os-fly');
  var pWrap=document.getElementById('os-phrase-wrap');
  var row=document.getElementById('logo-row');
  if(!logoEm||!fly||!pWrap||!row)return;

  var phrases=[
    '<span class="os-hl">O</span>perating <span class="os-hl">S</span>ystem',
    '<span class="os-hl">O</span>perational <span class="os-hl">S</span>urveillance',
    '<span class="os-hl">O</span>ver <span class="os-hl">S</span>ight'
  ];
  var pIdx=0,busy=false;

  function relSafe(el){
    var er=el.getBoundingClientRect();
    var nr=row.getBoundingClientRect();
    return{l:er.left-nr.left,t:er.top-nr.top};
  }
  function pos(el,l,t,tr){
    el.style.transition=tr||'none';
    el.style.left=l+'px';
    el.style.top=t+'px';
  }

  function osRun(){
    if(busy)return;
    busy=true;
    pIdx=0;
    var r=relSafe(logoEm);
    var flyW=fly.offsetWidth||36;
    var flyH=fly.offsetHeight||26;
    var cx=row.offsetWidth/2-flyW/2;
    var cy=row.offsetHeight/2-flyH/2;
    pos(fly,r.l,r.t);
    fly.style.opacity='0';
    logoEm.style.transition='opacity 0.12s';
    logoEm.style.opacity='0';
    requestAnimationFrame(function(){requestAnimationFrame(function(){
      fly.style.opacity='1';
      setTimeout(function(){
        pos(fly,cx,cy,'left 0.55s cubic-bezier(0.34,1.56,0.64,1), top 0.4s ease');
        setTimeout(osCycle,660);
      },40);
    });});
  }

  function osCycle(){
    if(pIdx>=phrases.length){osReturn();return}
    pWrap.innerHTML=phrases[pIdx];
    fly.style.transition='opacity 0.28s ease';
    fly.style.opacity='0';
    pWrap.style.transition='opacity 0.42s ease';
    pWrap.style.opacity='1';
    setTimeout(function(){
      pWrap.style.transition='opacity 0.32s ease';
      pWrap.style.opacity='0';
      setTimeout(function(){
        pIdx++;
        if(pIdx<phrases.length){
          fly.style.transition='opacity 0.18s ease';
          fly.style.opacity='1';
          setTimeout(osCycle,260);
        }else{
          setTimeout(osReturn,200);
        }
      },360);
    },2700);
  }

  function osReturn(){
    var r=relSafe(logoEm);
    fly.style.transition='opacity 0.18s ease';
    fly.style.opacity='1';
    setTimeout(function(){
      pos(fly,r.l,r.t,'left 0.4s cubic-bezier(0.6,-0.28,0.74,0.05), top 0.36s ease, opacity 0.16s ease 0.3s');
      fly.style.opacity='0';
      setTimeout(function(){
        logoEm.style.transition='opacity 0.25s';
        logoEm.style.opacity='1';
        busy=false;
        setTimeout(osRun,4500);
      },540);
    },160);
  }

  setTimeout(osRun,3000);
})();
