const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { runInNewContext } = require('node:vm');

function loadDemo() {
  const html = readFileSync(`${__dirname}/index.html`, 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const nodes = {};
  function node(id) {
    return nodes[id] ||= {
      hidden: false, textContent: '', alt: '', handlers: {}, children: [],
      addEventListener(event, fn) { this.handlers[event] = fn; },
      replaceChildren() { this.children = []; }, append() {}, appendChild(child) { this.children.push(child); }, scrollIntoView() {}
    };
  }
  const form = node('setup-form');
  form.elements = {
    code: { value: 'DEMO1234' }, name: { value: 'Bailey' },
    hideNameUntilLost: { checked: true }, photo: { files: [{ type: 'image/png' }] },
    detailsConfirmed: { checked: true, reportValidity() {} },
    desc: { value: 'Dog' }, temper: { value: 'Friendly' },
    needs: { value: 'None' }, note: { value: 'Hello' }
  };
  form.querySelectorAll = selector => selector === '[name=methods]:checked' ? [{ value: 'Call' }] : [];
  const linkForm = node('link-confirm-form');
  linkForm.elements = { linkSaved: { checked: false, reportValidity() {} } };
  node('activated').hidden = true;
  node('finder').hidden = true;
  const shareButtons = Array.from({ length: 4 }, (_, i) => node(`share-${i}`));
  const document = {
    getElementById: node,
    createElement: () => ({ textContent: '', handlers: {}, addEventListener(event, fn) { this.handlers[event] = fn; } }),
    querySelectorAll: selector => selector === '[data-demo-share]' ? shareButtons : []
  };
  function FileReader() { this.readAsDataURL = () => { this.result = 'data:image/png;base64,AA=='; this.onload(); }; }
  runInNewContext(script, { document, window: { scrollTo() {} }, FileReader });
  const submit = () => form.handlers.submit.call(form, { preventDefault() {} });
  const continueToFinder = () => linkForm.handlers.submit.call(linkForm, { preventDefault() {} });
  return { html, node, form, linkForm, shareButtons, submit, continueToFinder };
}

test('demo name visibility follows the checkbox and lost mode', () => {
  const { html, node, form, submit, continueToFinder, linkForm } = loadDemo();
  assert.match(html, /name="hideNameUntilLost"/);
  assert.match(html, /<p id="f-learn" hidden><a href="https:\/\/www\.vi-key\.uk\/lostandfound">Learn about V I Key®<\/a><\/p>/);
  const toggle = () => node('toggle-lost').handlers.click();

  submit();
  linkForm.elements.linkSaved.checked = true;
  continueToFinder();
  assert.equal(node('f-name').textContent, 'Hello! I’m wearing a V I Key® tag.');
  assert.equal(node('f-learn').hidden, false);
  assert.equal(node('f-photo').alt, 'Photo of the pet');
  toggle();
  assert.equal(node('f-name').textContent, 'Bailey');
  assert.equal(node('f-learn').hidden, true);
  assert.equal(node('f-photo').alt, 'Photo of Bailey');
  toggle();
  assert.equal(node('f-name').textContent, 'Hello! I’m wearing a V I Key® tag.');
  assert.equal(node('f-learn').hidden, false);
  assert.equal(node('f-photo').alt, 'Photo of the pet');
  form.elements.hideNameUntilLost.checked = false;
  submit();
  assert.equal(node('f-name').textContent, 'Bailey');
  assert.equal(node('f-learn').hidden, true);
  toggle();
  toggle();
  assert.equal(node('f-name').textContent, 'Bailey');
});

test('demo requires confirmations and simulates private-link sharing', () => {
  const { html, node, form, linkForm, shareButtons, submit, continueToFinder } = loadDemo();
  assert.match(html, /name="detailsConfirmed" value="yes" required/);
  assert.match(html, /name="linkSaved" required/);
  assert.match(html, /Don't include your home address, exact location, sensitive personal information/);
  assert.match(html, /Avoid photos showing people's faces, house numbers, address labels/);
  assert.match(html, /Don't include an address, exact location, sensitive information/);
  for (const label of ['Copy link', 'Text my private link to myself', 'Share privately with WhatsApp', 'Email my private link to myself']) {
    assert.match(html, new RegExp(`<button class="btn(?: sec)?" type="button" data-demo-share>${label}</button>`));
  }

  form.elements.detailsConfirmed.checked = false;
  submit();
  assert.equal(node('activated').hidden, true);
  assert.equal(node('test-buttons').children.length, 0);

  form.elements.detailsConfirmed.checked = true;
  submit();
  assert.equal(node('setup').hidden, true);
  assert.equal(node('activated').hidden, false);
  assert.equal(node('finder').hidden, true);
  assert.equal(node('test-buttons').children.length, 1);
  for (const button of shareButtons) {
    button.handlers.click();
    assert.match(node('share-status').textContent, /no link copied or sent/);
  }
  node('test-buttons').children[0].handlers.click();
  assert.match(node('test-status').textContent, /no app opened/);
  continueToFinder();
  assert.equal(node('finder').hidden, true);
  linkForm.elements.linkSaved.checked = true;
  continueToFinder();
  assert.equal(node('activated').hidden, true);
  assert.equal(node('finder').hidden, false);
  submit();
  assert.equal(linkForm.elements.linkSaved.checked, false);
});
