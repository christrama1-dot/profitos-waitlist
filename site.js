/* ProfitOS Engine — shared site JS: watchdog ticker + OS logo animation (ported from legacy index, To-Do #55) */
(function(){
  /* ---- watchdog ticker ---- */
  var track=document.getElementById('ticker');
  if(track){
    var agents=[['MarginScout','g'],['GrantHound','c'],['SubscriptionGuard','o'],['TaxTerrier','g'],['EquipmentLeaseGuard','c'],['PriceMax','k'],['Payment Pointer','o'],['ClaimBack','g'],['InsuranceGapFinder','c'],['DataPrivacyShield','o'],['CashFlowGuard','g'],['LoanScout','k'],['...and growing','g']];
    var dot={g:'tk-g',o:'tk-o',c:'tk-c',k:'tk-k'};
    var full=agents.concat(agents,agents,agents);
    track.innerHTML=full.map(function(a){return '<div class="tk-chip"><span class="tk-dot '+dot[a[1]]+'"></span><span class="tk-name">'+a[0]+'</span></div>';}).join('');
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
    '<span class="os-hl">O</span>perating\u00a0<span class="os-hl">S</span>ystem',
    '<span class="os-hl">O</span>perational\u00a0<span class="os-hl">S</span>urveillance',
    '<span class="os-hl">O</span>ver\u00a0<span class="os-hl">S</span>ight'
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
