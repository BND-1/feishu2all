// Debug script to check Feishu heading structure
// Run this in the browser console on a Feishu document page

console.log('=== Feishu Heading Structure Debug ===\n');

// 1. Check for standard heading tags
const standardHeadings = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
console.log(`1. Standard heading tags (h1-h6): ${standardHeadings.length}`);
standardHeadings.forEach((h, i) => {
  console.log(`  ${h.tagName}: "${h.textContent?.substring(0, 50)}"`);
});

// 2. Check for Feishu-specific heading classes
const feishuHeadings = document.querySelectorAll('[class*="heading"], [data-block-type*="heading"]');
console.log(`\n2. Feishu heading elements: ${feishuHeadings.length}`);
feishuHeadings.forEach((h, i) => {
  if (i < 5) {
    console.log(`  ${h.className}:`, {
      text: h.textContent?.substring(0, 50),
      tagName: h.tagName,
      dataBlockType: h.getAttribute('data-block-type'),
    });
  }
});

// 3. Check content container structure
const container = document.querySelector('.doc-render, .wiki-render, .docs-reader, [class*="render"]');
if (container) {
  console.log('\n3. Container structure:');
  const children = Array.from(container.children).slice(0, 10);
  children.forEach((child, i) => {
    console.log(`  Child ${i + 1}:`, {
      tagName: child.tagName,
      className: child.className.substring(0, 50),
      dataBlockType: child.getAttribute('data-block-type'),
      text: child.textContent?.substring(0, 30),
    });
  });
}

// 4. Check if headings are inside divs
const headingDivs = document.querySelectorAll('div[data-block-type="heading1"], div[data-block-type="heading2"]');
console.log(`\n4. Heading divs: ${headingDivs.length}`);
headingDivs.forEach((div, i) => {
  if (i < 3) {
    const actualHeading = div.querySelector('h1, h2, h3, h4, h5, h6, .heading');
    console.log(`  Div ${i + 1}:`, {
      dataBlockType: div.getAttribute('data-block-type'),
      hasHeadingTag: !!actualHeading,
      headingTag: actualHeading?.tagName,
      text: div.textContent?.substring(0, 50),
    });
  }
});

console.log('\n=== Debug Complete ===');
