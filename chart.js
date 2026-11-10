/* Hand-drawn canvas charts. No chart library. Placeholder axes only. */
(function () {
  function drawPlaceholder(canvas) {
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = "#333";
    ctx.beginPath();
    ctx.moveTo(24, 12);
    ctx.lineTo(24, h - 20);
    ctx.lineTo(w - 12, h - 20);
    ctx.stroke();
    ctx.strokeStyle = "#4a4";
    ctx.beginPath();
    ctx.moveTo(24, h - 20);
    ctx.lineTo(w - 12, h / 2);
    ctx.stroke();
  }
  drawPlaceholder(document.getElementById("chart"));
  window.drawDeskChart = drawPlaceholder;
})();
