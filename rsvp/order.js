/* ============================================================
   V I Key® — Shared Order Page JavaScript
   Form handling, package selection & FAQ accordion
   ============================================================ */

(function () {
    'use strict';

    // --- FAQ Accordion ---
    document.querySelectorAll('.faq-question').forEach(function (button) {
        button.addEventListener('click', function () {
            var item = button.closest('.faq-item');
            var isOpen = item.classList.contains('open');
            // Close all others
            document.querySelectorAll('.faq-item.open').forEach(function (other) {
                if (other !== item) other.classList.remove('open');
            });
            item.classList.toggle('open', !isOpen);
        });
    });

    // --- Package Selection ---
    var packageField = document.getElementById('package');
    var cardsField = document.getElementById('cardCount');

    document.querySelectorAll('.package-btn').forEach(function (button) {
        button.addEventListener('click', function () {
            var pkg = button.getAttribute('data-package');
            var count = button.getAttribute('data-cards');
            if (packageField) {
                packageField.value = pkg;
                packageField.dispatchEvent(new Event('change'));
            }
            if (cardsField) cardsField.value = count;
            var form = document.getElementById('orderForm');
            if (form) form.scrollIntoView({ behavior: 'smooth', block: 'center' });
            var nameField = document.getElementById('name');
            if (nameField) setTimeout(function () { nameField.focus(); }, 500);
        });
    });

    // --- Form Submission ---
    var form = document.getElementById('orderForm');
    if (!form) return;

    form.addEventListener('submit', async function (event) {
        event.preventDefault();
        var submitBtn = document.getElementById('submitBtn');
        var feedback = document.getElementById('formFeedback');
        var originalText = submitBtn.textContent;

        submitBtn.disabled = true;
        submitBtn.textContent = 'Sending…';
        feedback.className = 'form-feedback';
        feedback.textContent = '';

        var payload = {
            action: 'submit-order',
            name: form.elements.name.value.trim(),
            email: form.elements.email.value.trim(),
            phone: form.elements.phone.value.trim(),
            eventDate: form.elements.eventDate.value,
            eventType: form.elements.eventType.value,
            package: form.elements.package.value,
            cardCount: Number(form.elements.cardCount.value) || 0,
            message: form.elements.message.value.trim()
        };

        try {
            var response = await fetch('/api/package-order', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            var data = await response.json();
            if (!response.ok || !data.success) {
                throw new Error(data.error || 'Something went wrong. Please try again.');
            }
            feedback.className = 'form-feedback success';
            feedback.textContent = 'Thank you! Your order request has been sent. We\u2019ll be in touch within 24 hours to confirm your package and next steps.';
            form.reset();
        } catch (error) {
            feedback.className = 'form-feedback error';
            feedback.textContent = error.message || 'Unable to submit your order. Please email us directly.';
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = originalText;
            feedback.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    });
})();
