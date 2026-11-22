const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { runInNewContext } = require('node:vm');

test('demo name visibility follows the checkbox and lost mode', () => {
  const html = readFileSync(`${__dirname}/index.html`, 'utf8');
  assert.match(html, /name="hideNameUntilLost"/);
  assert.match(html, /<p id="f-learn" hidden><a href="https:\/\/www\.vi-key\.uk\/lostandfound">Learn about V I Key®<\/a><\/p>/);
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const nodes = {};
  function node(id) {
    return nodes[id] ||= {
      hidden: false, textContent: '', alt: '', handlers: {},
      addEventListener(event, fn) { this.handlers[event] = fn; },
      replaceChildren() {}, append() {}, appendChild() {}, scrollIntoView() {}
    };
  }
  const form = node('setup-form');
  form.elements = {
    code: { value: 'DEMO1234' }, name: { value: 'Bailey' },
    hideNameUntilLost: { checked: true }, photo: { files: [{ type: 'image/png' }] },
    desc: { value: 'Dog' }, temper: { value: 'Friendly' },
    needs: { value: 'None' }, note: { value: 'Hello' }
  };
  form.querySelectorAll = selector => selector === '[name=methods]:checked' ? [{ value: 'Call' }] : [];
  const document = { getElementById: node, createElement: () => node('button') };
  function FileReader() { this.readAsDataURL = () => { this.result = 'data:image/png;base64,AA=='; this.onload(); }; }
  runInNewContext(script, { document, window: { scrollTo() {} }, FileReader });
  const submit = () => form.handlers.submit.call(form, { preventDefault() {} });
  const toggle = () => node('toggle-lost').handlers.click();

  submit();
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
