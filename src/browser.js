// Arranque del navegador del sistema para imprimir PDF (puppeteer-core no descarga Chromium).
// Prueba cada candidato en orden hasta que uno inicie: así una actualización a medias de Edge
// (que hace salir al proceso enseguida) no rompe la exportación si hay Chrome instalado.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

export function browserCandidates() {
  return [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/microsoft-edge',
  ].filter((p) => p && fs.existsSync(p));
}

/** Devuelve { browser, close } con un perfil temporal propio. */
export async function launchBrowser() {
  const errors = [];
  for (const executablePath of browserCandidates()) {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cyber-cactus-'));
    try {
      const browser = await puppeteer.launch({ executablePath, headless: true, userDataDir, args: ['--no-sandbox', '--disable-gpu'] });
      return {
        browser,
        async close() {
          await browser.close();
          fs.rmSync(userDataDir, { recursive: true, force: true });
        },
      };
    } catch (e) {
      errors.push(`${path.basename(executablePath)}: ${e.message.split('\n')[0]}`);
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }
  }
  throw Object.assign(
    new Error(`No se pudo abrir Chrome ni Edge para generar el PDF. ${errors.join(' · ') || 'No hay ninguno instalado.'} Configurá CHROME_PATH en .env.`),
    { status: 500 }
  );
}
