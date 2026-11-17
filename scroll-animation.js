/**
 * SmoothScrollVideo - High-Performance Scroll-Controlled Frame Sequence Animation
 *
 * Features:
 * - Chunked asynchronous preloader (fast initial render, zero network bottleneck)
 * - Full-page continuous scroll scrubbing
 * - Sub-pixel LERP smoothing for organic momentum
 * - Bidirectional instant playback
 * - Retina/High-DPI canvas buffer scaling with 'cover' and 'contain' fit modes
 * - Anti-flicker memory caching with nearest-cached fallback
 * - Auto-sleeping RAF loop to conserve CPU and battery
 */
class SmoothScrollVideo {
  constructor(options = {}) {
    this.totalFrames = options.totalFrames || 300;
    this.framePath = options.framePath || ((idx) => `frames/ezgif-frame-${String(idx).padStart(3, '0')}.jpg`);
    this.canvas = typeof options.canvas === 'string' ? document.querySelector(options.canvas) : options.canvas;
    this.container = options.container ? (typeof options.container === 'string' ? document.querySelector(options.container) : options.container) : null;
    this.globalScroll = options.globalScroll !== undefined ? options.globalScroll : (!this.container);
    this.fitMode = options.fitMode || 'cover';
    this.lerpFactor = options.lerpFactor !== undefined ? options.lerpFactor : 0.08;
    this.onProgress = options.onProgress || null;
    this.onLoadProgress = options.onLoadProgress || null;
    this.onReady = options.onReady || null;

    if (!this.canvas) {
      throw new Error('[SmoothScrollVideo] Canvas element is required.');
    }

    this.ctx = this.canvas.getContext('2d', { alpha: false });
    this.images = new Array(this.totalFrames);
    this.loadedImages = new Set();
    this.targetProgress = 0;
    this.currentProgress = 0;
    this.lastRenderedIndex = -1;
    this.isTicking = false;
    this.isReady = false;
    this.nativeWidth = 1920;
    this.nativeHeight = 1080;

    this.init();
  }

  init() {
    this.setupResizeHandler();
    this.handleResize();
    this.preloadSequence();
    this.setupScrollListener();
  }

  setupResizeHandler() {
    window.addEventListener('resize', () => {
      this.handleResize();
      this.updateScrollTarget();
    }, { passive: true });
  }

  handleResize() {
    if (!this.canvas) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = this.canvas.getBoundingClientRect();
    const width = rect.width || window.innerWidth;
    const height = rect.height || window.innerHeight;

    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);

    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = 'high';

    if (this.loadedImages.size > 0) {
      this.drawFrame(this.currentProgress * (this.totalFrames - 1) + 1, true);
    }
  }

  preloadSequence() {
    let loadedCount = 0;
    const total = this.totalFrames;

    const onImageLoaded = (idx, img) => {
      this.images[idx - 1] = img;
      this.loadedImages.add(idx);
      loadedCount++;

      if (idx === 1 && img.naturalWidth) {
        this.nativeWidth = img.naturalWidth;
        this.nativeHeight = img.naturalHeight;
        this.handleResize();
        this.drawFrame(1, true);
      }

      if (this.onLoadProgress) {
        this.onLoadProgress(loadedCount / total, loadedCount, total);
      }

      if (loadedCount === total) {
        this.isReady = true;
        if (this.onReady) this.onReady();
      }
    };

    // 1. Immediately load frame 1 for instant display
    const firstImg = new Image();
    firstImg.src = this.framePath(1);
    firstImg.onload = () => onImageLoaded(1, firstImg);
    firstImg.onerror = () => {
      console.warn('[SmoothScrollVideo] Error loading frame 1, trying next frames');
    };

    // 2. Load the remaining frames in smooth staggered batches of 6 (matching HTTP connection concurrency)
    let nextIndex = 2;
    const concurrency = 6;

    const loadNext = () => {
      if (nextIndex > total) return;
      const current = nextIndex++;
      const img = new Image();
      img.src = this.framePath(current);

      img.onload = () => {
        onImageLoaded(current, img);
        loadNext();
      };

      img.onerror = () => {
        loadedCount++;
        loadNext();
      };
    };

    // Spawn concurrent workers
    for (let i = 0; i < concurrency; i++) {
      loadNext();
    }
  }

  setupScrollListener() {
    window.addEventListener('scroll', () => this.updateScrollTarget(), { passive: true });
    this.updateScrollTarget();
  }

  updateScrollTarget() {
    if (this.globalScroll || !this.container) {
      const scrollMax = document.documentElement.scrollHeight - window.innerHeight;
      this.targetProgress = scrollMax > 0 ? Math.max(0, Math.min(1, window.scrollY / scrollMax)) : 0;
    } else {
      const rect = this.container.getBoundingClientRect();
      const totalScrollable = this.container.offsetHeight - window.innerHeight;
      if (totalScrollable > 0) {
        const currentScroll = -rect.top;
        this.targetProgress = Math.max(0, Math.min(1, currentScroll / totalScrollable));
      } else {
        this.targetProgress = 0;
      }
    }

    this.requestTick();
  }

  requestTick() {
    if (!this.isTicking) {
      this.isTicking = true;
      requestAnimationFrame(() => this.update());
    }
  }

  update() {
    const diff = this.targetProgress - this.currentProgress;

    if (Math.abs(diff) > 0.0001) {
      this.currentProgress += diff * this.lerpFactor;
      this.render();
      requestAnimationFrame(() => this.update());
    } else {
      this.currentProgress = this.targetProgress;
      this.render();
      this.isTicking = false;
    }
  }

  render() {
    const rawFrame = this.currentProgress * (this.totalFrames - 1) + 1;
    this.drawFrame(rawFrame);

    if (this.onProgress) {
      this.onProgress(this.currentProgress, Math.round(rawFrame));
    }
  }

  findNearestLoadedImage(targetIndex) {
    if (this.loadedImages.has(targetIndex)) {
      return this.images[targetIndex - 1];
    }

    // Search outwards from targetIndex to find the closest cached frame
    for (let offset = 1; offset < this.totalFrames; offset++) {
      const lower = targetIndex - offset;
      if (lower >= 1 && this.loadedImages.has(lower)) {
        return this.images[lower - 1];
      }
      const upper = targetIndex + offset;
      if (upper <= this.totalFrames && this.loadedImages.has(upper)) {
        return this.images[upper - 1];
      }
    }

    return null;
  }

  drawFrame(exactFrameNumber, forceRedraw = false) {
    const frameIndex = Math.min(this.totalFrames, Math.max(1, Math.round(exactFrameNumber)));

    if (!forceRedraw && frameIndex === this.lastRenderedIndex) {
      return;
    }

    const img = this.findNearestLoadedImage(frameIndex);
    if (!img) return;

    this.lastRenderedIndex = frameIndex;

    const canvasWidth = this.canvas.width;
    const canvasHeight = this.canvas.height;
    const imgWidth = img.naturalWidth || this.nativeWidth;
    const imgHeight = img.naturalHeight || this.nativeHeight;

    const imgRatio = imgWidth / imgHeight;
    const canvasRatio = canvasWidth / canvasHeight;

    let drawWidth, drawHeight, offsetX, offsetY;

    if (this.fitMode === 'cover') {
      if (canvasRatio > imgRatio) {
        drawWidth = canvasWidth;
        drawHeight = canvasWidth / imgRatio;
        offsetX = 0;
        offsetY = (canvasHeight - drawHeight) / 2;
      } else {
        drawWidth = canvasHeight * imgRatio;
        drawHeight = canvasHeight;
        offsetX = (canvasWidth - drawWidth) / 2;
        offsetY = 0;
      }
    } else {
      if (canvasRatio > imgRatio) {
        drawWidth = canvasHeight * imgRatio;
        drawHeight = canvasHeight;
        offsetX = (canvasWidth - drawWidth) / 2;
        offsetY = 0;
      } else {
        drawWidth = canvasWidth;
        drawHeight = canvasWidth / imgRatio;
        offsetX = 0;
        offsetY = (canvasHeight - drawHeight) / 2;
      }
    }

    this.ctx.clearRect(0, 0, canvasWidth, canvasHeight);
    this.ctx.drawImage(img, offsetX, offsetY, drawWidth, drawHeight);
  }

  setProgress(progress, instant = false) {
    this.targetProgress = Math.max(0, Math.min(1, progress));
    if (instant) {
      this.currentProgress = this.targetProgress;
      this.render();
    } else {
      this.requestTick();
    }
  }

  destroy() {
    window.removeEventListener('resize', this.handleResize);
    window.removeEventListener('scroll', this.updateScrollTarget);
    this.images = [];
    this.loadedImages.clear();
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = SmoothScrollVideo;
} else {
  window.SmoothScrollVideo = SmoothScrollVideo;
}
