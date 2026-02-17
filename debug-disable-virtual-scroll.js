// Debug script to disable Feishu virtual scrolling
// Run this in the browser console on a Feishu document page

console.log('=== Attempting to disable virtual scrolling ===');

// Method 1: Force render all content by setting container height
const containers = document.querySelectorAll('.doc-render, .wiki-render, .docs-reader, [class*="render"]');
console.log(`Found ${containers.length} potential containers`);

containers.forEach((container, i) => {
  console.log(`Container ${i + 1}:`, {
    className: container.className,
    scrollHeight: container.scrollHeight,
    clientHeight: container.clientHeight,
  });

  // Try to force full height
  const el = container as HTMLElement;
  el.style.height = 'auto';
  el.style.maxHeight = 'none';
  el.style.overflow = 'visible';
});

// Method 2: Find and modify virtual scroll settings
console.log('\n=== Checking for virtual scroll configuration ===');
const scripts = document.querySelectorAll('script');
scripts.forEach(script => {
  const content = script.textContent || '';
  if (content.includes('virtual') || content.includes('lazy') || content.includes('viewport')) {
    console.log('Found potential virtual scroll config:', content.substring(0, 200));
  }
});

// Method 3: Check window object for virtual scroll settings
console.log('\n=== Checking window object ===');
const windowKeys = Object.keys(window).filter(key =>
  key.toLowerCase().includes('virtual') ||
  key.toLowerCase().includes('scroll') ||
  key.toLowerCase().includes('lazy')
);
console.log('Relevant window keys:', windowKeys);

// Method 4: Try to trigger full render by scrolling
console.log('\n=== Attempting to trigger full render ===');
const scrollContainer = document.querySelector('.doc-render, .wiki-render, .docs-reader') as HTMLElement;
if (scrollContainer) {
  const originalHeight = scrollContainer.style.height;
  scrollContainer.style.height = `${scrollContainer.scrollHeight}px`;
  console.log('Set container height to:', scrollContainer.scrollHeight);

  // Wait a bit then check
  setTimeout(() => {
    const allContent = scrollContainer.innerHTML;
    console.log('Content length after height change:', allContent.length);
    console.log('Image count:', scrollContainer.querySelectorAll('img').length);
  }, 1000);
}

console.log('\n=== Debug complete ===');
