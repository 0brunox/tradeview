// Aviso sonoro e notificação do sistema para os alertas de preço.

let audioCtx = null;

/**
 * Dois bipes curtos, sintetizados no WebAudio (sem arquivo de áudio no bundle).
 * O browser só libera áudio depois de alguma interação do usuário — criar um
 * alerta ou marcar o checkbox de som já conta como essa interação.
 */
export function playAlertBeep() {
  try {
    const Ctx = window.AudioContext ?? window.webkitAudioContext;
    if (!Ctx) return;
    audioCtx = audioCtx ?? new Ctx();
    if (audioCtx.state === 'suspended') audioCtx.resume();

    const now = audioCtx.currentTime;
    [880, 1320].forEach((freq, i) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const t0 = now + i * 0.18;
      // Envelope exponencial: sem o ataque/decaimento o bipe estala.
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.22, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.16);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.2);
    });
  } catch {
    /* áudio bloqueado — o aviso na tela continua valendo */
  }
}

/** 'unsupported' | 'default' (ainda não perguntamos) | 'granted' | 'denied'. */
export function notificationState() {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission;
}

/** Pede a permissão — precisa ser chamada a partir de um clique do usuário. */
export async function askNotificationPermission() {
  if (typeof Notification === 'undefined') return 'unsupported';
  if (Notification.permission !== 'default') return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch {
    return 'denied';
  }
}

/** Notificação do sistema — funciona com a aba em segundo plano. */
export function showNotification(title, body, tag) {
  try {
    if (notificationState() !== 'granted') return;
    new Notification(title, { body, tag, renotify: false });
  } catch {
    /* alguns browsers exigem service worker — ignoramos */
  }
}
