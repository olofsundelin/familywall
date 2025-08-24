export function playSound(filename) {
  const audio = new Audio(`/sounds/${filename}`);
  audio.play().catch((e) => {
    console.warn("Kunde inte spela ljud:", e);
  });
}