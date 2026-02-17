// Feishu DOM Structure Debug Script
// Copy and paste this into the browser console on a Feishu document page

console.log('=== Feishu DOM Debug ===');

// 1. Find all images on the page
const allImages = document.querySelectorAll('img');
console.log(`\n1. Total images on page: ${allImages.length}`);
allImages.forEach((img, i) => {
  console.log(`Image ${i + 1}:`, {
    src: img.src.substring(0, 100),
    dataSrc: img.getAttribute('data-src')?.substring(0, 100),
    width: img.width,
    height: img.height,
    parent: img.parentElement?.className,
  });
});

// 2. Test content selectors
const selectors = [
  '.doc-render',
  '.wiki-render',
  '.docs-reader',
  '[class*="render"]',
  'article',
  'main',
];

console.log('\n2. Testing content selectors:');
selectors.forEach(selector => {
  const el = document.querySelector(selector);
  if (el) {
    const images = el.querySelectorAll('img');
    console.log(`${selector}:`, {
      found: true,
      textLength: el.textContent?.length || 0,
      imageCount: images.length,
      className: el.className,
    });
  } else {
    console.log(`${selector}: NOT FOUND`);
  }
});

// 3. Find the largest text container
console.log('\n3. Finding largest text containers:');
const allDivs = document.querySelectorAll('div');
const containers = Array.from(allDivs)
  .map(div => ({
    element: div,
    textLength: div.textContent?.length || 0,
    imageCount: div.querySelectorAll('img').length,
    className: div.className,
  }))
  .filter(c => c.textLength > 500)
  .sort((a, b) => b.textLength - a.textLength)
  .slice(0, 5);

containers.forEach((c, i) => {
  console.log(`Container ${i + 1}:`, {
    textLength: c.textLength,
    imageCount: c.imageCount,
    className: c.className.substring(0, 50),
  });
});

// 4. Check for lazy-loaded images
console.log('\n4. Checking lazy-load attributes:');
const lazyImages = document.querySelectorAll('img[data-src], img[data-original], img[_src]');
console.log(`Images with lazy-load attributes: ${lazyImages.length}`);

// 5. Find images by URL pattern
console.log('\n5. Feishu CDN images:');
const feishuImages = Array.from(allImages).filter(img =>
  img.src.includes('feishu.cn') ||
  img.getAttribute('data-src')?.includes('feishu.cn')
);
console.log(`Feishu CDN images: ${feishuImages.length}`);
feishuImages.forEach((img, i) => {
  console.log(`Feishu image ${i + 1}:`, img.src.substring(0, 100));
});

console.log('\n=== Debug Complete ===');
