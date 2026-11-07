// Middleware da Vercel — roda antes de entregar qualquer arquivo do site.
//
// Só entrega apostilas, questões, flashcards e demais páginas para quem
// está logado E com o acesso em dia (mesma regra da função
// public.acesso_valido() do Supabase: admin, ou aprovado com acesso_ate
// vazio ou no futuro). O token vem do cookie "alfa_token", que o
// sync-offline.js grava a cada login/renovação.
//
// Ficam abertos só os arquivos da tela de login (PUBLICOS abaixo). Quem
// não tem acesso é mandado para a página inicial (que mostra o login ou o
// aviso de acesso vencido) e, depois de entrar, volta para onde estava.

const SUPABASE_URL = 'https://ghlaukrbwwecpeanlmlp.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_jKB_xy4LMBIBcLV_i0wa3A_TgBJAihh';
const AUTH_COOKIE = 'alfa_token';
const DEVICE_COOKIE = 'alfa_disp';

const PUBLICOS = new Set([
  '/',
  '/index.html',
  '/sw.js',
  '/manifest.json',
  '/gamification.js',
  '/sync-offline.js',
  '/study-room.js',
  '/robots.txt',
  '/favicon.ico'
]);

function ehPublico(caminho) {
  if (PUBLICOS.has(caminho)) return true;
  if (caminho.startsWith('/icons/')) return true;
  if (/^\/login-[\w-]+\.(jpg|jpeg|png|webp)$/.test(caminho)) return true;
  return false;
}

function lerCookie(request, nome) {
  const cookies = request.headers.get('cookie') || '';
  for (const parte of cookies.split(';')) {
    const [chave, ...resto] = parte.trim().split('=');
    if (chave === nome) return resto.join('=');
  }
  return '';
}

// true = em dia, false = sem acesso, null = não deu para conferir
// (Supabase fora do ar): nesse caso deixa passar para não derrubar o site
// de todo mundo; a página ainda confere o acesso por conta própria.
async function acessoValido(token, dispositivo) {
  try {
    const headers = {
      apikey: SUPABASE_ANON_KEY,
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json'
    };
    // Mesmo formato que o sync-offline.js usa no navegador: o banco
    // confere se este é o aparelho registrado na conta.
    if (/^[A-Za-z0-9-]{1,64}$/.test(dispositivo)) headers['X-Client-Info'] = 'alfa-middleware alfa-disp=' + dispositivo;
    const resposta = await fetch(SUPABASE_URL + '/rest/v1/rpc/acesso_valido', {
      method: 'POST',
      headers,
      body: '{}'
    });
    if (resposta.status === 401 || resposta.status === 403) return false;
    if (!resposta.ok) return null;
    return (await resposta.json()) === true;
  } catch (e) {
    return null;
  }
}

function bloquear(request, url) {
  const ehPagina = (request.headers.get('accept') || '').includes('text/html');
  if (ehPagina) {
    const destino = new URL('/index.html', url);
    destino.searchParams.set('next', url.pathname + url.search);
    return Response.redirect(destino, 302);
  }
  return new Response('Acesso restrito a assinantes.', {
    status: 401,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

export default async function middleware(request) {
  const url = new URL(request.url);
  const caminho = decodeURIComponent(url.pathname);

  // Arquivos SQL de configuração do banco não são para o público.
  if (caminho.endsWith('.sql')) {
    return new Response('Não encontrado.', { status: 404 });
  }

  if (ehPublico(caminho)) return;

  const token = lerCookie(request, AUTH_COOKIE);
  if (!token) return bloquear(request, url);

  const valido = await acessoValido(token, lerCookie(request, DEVICE_COOKIE));
  if (valido === false) return bloquear(request, url);
}
