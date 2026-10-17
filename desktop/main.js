const {app,BrowserWindow,ipcMain,dialog,shell}=require('electron');
const http=require('http');
const {spawn}=require('child_process');const fs=require('fs'),path=require('path'),crypto=require('crypto');
// ▼ Google Cloud コンソールで作成した「デスクトップ アプリ」の OAuth クライアント（ログイン用）
const G_CLIENT_ID='YOUR_DESKTOP_CLIENT_ID.apps.googleusercontent.com',G_CLIENT_SECRET='YOUR_DESKTOP_CLIENT_SECRET';
const SITE='https://potatosalad-san.github.io/Shogi-Analyzer/'; // ← 自分のGitHub PagesのURLに合わせる
const cfg=()=>path.join(app.getPath('userData'),'engine.json');
function rd(){let c={};try{c=JSON.parse(fs.readFileSync(cfg(),'utf8'))}catch(e){}
  if(!c.engines)c.engines=c.path?[{id:crypto.randomUUID(),name:path.basename(c.path).replace(/\.exe$/i,''),path:c.path}]:[];
  if(!c.active||!c.engines.some(e=>e.id===c.active))c.active=c.engines[0]?c.engines[0].id:null;return c}
const wr=c=>fs.writeFileSync(cfg(),JSON.stringify({engines:c.engines,active:c.active}));
let win=null,proc=null,buf='';
const ok=e=>e.senderFrame&&e.senderFrame.url.startsWith(SITE);
const pub=c=>({engines:c.engines.map(e=>({id:e.id,name:e.name})),active:c.active});
function createWindow(){
  win=new BrowserWindow({width:1280,height:860,webPreferences:{preload:path.join(__dirname,'preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  win.webContents.setUserAgent(win.webContents.getUserAgent().replace(/ Electron\/[\d.]+/,'').replace(/ shogi-?analyzer\/[\d.]+/i,''));
  win.webContents.on('will-navigate',(ev,url)=>{if(!url.startsWith(SITE)){ev.preventDefault();shell.openExternal(url)}});
  win.webContents.setWindowOpenHandler(({url})=>{shell.openExternal(url);return{action:'deny'}});
  win.setMenuBarVisibility(false);win.loadURL(SITE);
}
ipcMain.handle('eng:list',e=>ok(e)?pub(rd()):{engines:[],active:null});
ipcMain.handle('eng:add',async e=>{if(!ok(e))return null;
  const r=await dialog.showOpenDialog(win,{properties:['openFile'],filters:[{name:'USIエンジン',extensions:['exe']},{name:'すべて',extensions:['*']}]});
  if(r.canceled)return null;const c=rd(),p=r.filePaths[0],id=crypto.randomUUID();
  c.engines.push({id,name:path.basename(p).replace(/\.exe$/i,''),path:p});c.active=id;wr(c);return id});
ipcMain.handle('eng:rename',(e,id,name)=>{if(!ok(e))return;const c=rd(),x=c.engines.find(v=>v.id===id);if(x&&typeof name==='string'){x.name=name.slice(0,60);wr(c)}});
ipcMain.handle('eng:remove',(e,id)=>{if(!ok(e))return;const c=rd();c.engines=c.engines.filter(v=>v.id!==id);wr(c)});
ipcMain.handle('eng:select',(e,id)=>{if(!ok(e))return;const c=rd();if(c.engines.some(v=>v.id===id)){c.active=id;wr(c)}});
ipcMain.handle('eng:start',async e=>{if(!ok(e))return{ok:false,error:'権限がありません'};
  const c=rd(),x=c.engines.find(v=>v.id===c.active);
  if(!x||!fs.existsSync(x.path))return{ok:false,error:'エンジンが未登録か、ファイルが見つかりません。「追加」でエンジンのexeを登録してください'};
  if(proc){try{proc.kill()}catch(_){}}buf='';
  const send=l=>{if(win&&!win.isDestroyed())win.webContents.send('eng:line',l)};
  const p=spawn(x.path,[],{cwd:path.dirname(x.path)});proc=p;
  p.stdout.on('data',d=>{buf+=d.toString();let i;while((i=buf.indexOf('\n'))>=0){send(buf.slice(0,i).replace(/\r$/,''));buf=buf.slice(i+1)}});
  p.stderr.on('data',d=>send('info string stderr '+d.toString().trim()));
  p.on('exit',code=>{send('info string engine exited '+code);if(proc===p)proc=null});
  p.on('error',err=>send('info string spawn error '+err.message));
  return{ok:true,path:x.path,id:x.id,name:x.name}});
ipcMain.on('eng:send',(e,t)=>{if(ok(e)&&proc&&typeof t==='string')proc.stdin.write(t+'\n')});
const b64u=b=>b.toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
// Googleログイン: 既定のブラウザで認証し、ループバック(127.0.0.1)で認可コードを受け取る（PKCE）
ipcMain.handle('auth:google',e=>{if(!ok(e))return{ok:false,error:'権限がありません'};
  if(G_CLIENT_ID.startsWith('YOUR'))return{ok:false,error:'main.js の G_CLIENT_ID / G_CLIENT_SECRET が未設定です'};
  return new Promise(resolve=>{
    const ver=b64u(crypto.randomBytes(32)),chal=b64u(crypto.createHash('sha256').update(ver).digest()),state=b64u(crypto.randomBytes(16));
    let done=false;const fin=r=>{if(done)return;done=true;clearTimeout(tm);srv.close();resolve(r)};
    const srv=http.createServer(async(req,res)=>{const u=new URL(req.url,'http://127.0.0.1');if(u.pathname!=='/'){res.writeHead(404).end();return}
      const code=u.searchParams.get('code'),err=u.searchParams.get('error');
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
      res.end('<meta charset="utf-8"><body style="font-family:sans-serif;padding:2em"><h2>'+(code?'ログインしました':'ログインできませんでした')+'</h2><p>このタブを閉じて、アプリに戻ってください。</p>');
      if(u.searchParams.get('state')!==state||!code)return fin({ok:false,error:err||'認可コードを受け取れませんでした'});
      try{const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
        body:new URLSearchParams({code,client_id:G_CLIENT_ID,client_secret:G_CLIENT_SECRET,code_verifier:ver,grant_type:'authorization_code',redirect_uri:'http://127.0.0.1:'+srv.address().port})});
        const j=await r.json();if(!j.id_token)return fin({ok:false,error:j.error_description||j.error||'トークン取得に失敗しました'});
        fin({ok:true,idToken:j.id_token,accessToken:j.access_token})}catch(x){fin({ok:false,error:x.message})}});
    const tm=setTimeout(()=>fin({ok:false,error:'タイムアウト（3分）'}),180000);
    srv.listen(0,'127.0.0.1',()=>{shell.openExternal('https://accounts.google.com/o/oauth2/v2/auth?'+new URLSearchParams({client_id:G_CLIENT_ID,redirect_uri:'http://127.0.0.1:'+srv.address().port,response_type:'code',scope:'openid email profile',code_challenge:chal,code_challenge_method:'S256',state,prompt:'select_account'}))});
  })});
app.whenReady().then(createWindow);
app.on('window-all-closed',()=>{if(proc)proc.kill();app.quit()});
 
