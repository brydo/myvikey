/* Shrinks a chosen image on the user's device to a small JPEG (also drops camera/GPS metadata). */
window.MyCardImage = (function () {
    var MAX_BYTES = 200000;
    function shrink(file, maxSide) {
        return createImageBitmap(file).then(function (bmp) {
            var scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
            var c = document.createElement('canvas');
            c.width = Math.max(1, Math.round(bmp.width * scale));
            c.height = Math.max(1, Math.round(bmp.height * scale));
            var g = c.getContext('2d');
            g.fillStyle = '#fff';
            g.fillRect(0, 0, c.width, c.height);
            g.drawImage(bmp, 0, 0, c.width, c.height);
            return new Promise(function (resolve) {
                (function attempt(q) {
                    c.toBlob(function (b) {
                        if (!b) return resolve(null);
                        if (b.size <= MAX_BYTES || q <= 0.3) return resolve(b);
                        attempt(q - 0.1);
                    }, 'image/jpeg', q);
                })(0.85);
            });
        });
    }
    return { shrink: shrink };
})();
