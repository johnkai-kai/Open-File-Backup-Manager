const http=require('node:http');
const fs=require('node:fs/promises');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const allowed=new Set(['/','/index.html','/src/app.js','/src/i18n.js','/src/styles.css','/src/assets/fold.svg','/src/assets/Manrope.ttf','/src/assets/InstrumentSans.ttf','/src/assets/canopy-atmosphere.png','/src/assets/nocturne-atmosphere.png']);
http.createServer(async(req,res)=>{
  const name=new URL(req.url,'http://127.0.0.1').pathname;
  if(!allowed.has(name)){res.writeHead(404);res.end();return;}
  try{const file=path.join(root,name==='/'?'index.html':name.slice(1));const bytes=await fs.readFile(file);const mime={'.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.ttf':'font/ttf','.png':'image/png'};res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'text/html','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(bytes);}catch{res.writeHead(500);res.end();}
}).listen(5186,'127.0.0.1',()=>console.log('Design preview: http://127.0.0.1:5186 (no filesystem access)'));
