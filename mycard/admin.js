(() => {
  const adminStatusEl = document.getElementById('adminStatus');
  const clearBtn = document.getElementById('clearPublicDataBtn');
  const exportBtn = document.getElementById('exportBtn');

  const STORAGE_KEY = 'myvikey_public_data';

  function setAdminStatus(msg) {
    if (adminStatusEl) adminStatusEl.textContent = msg;
  }

  clearBtn?.addEventListener('click', () => {
    localStorage.removeItem(STORAGE_KEY);
    setAdminStatus('Public data cleared.');
  });

  exportBtn?.addEventListener('click', () => {
    const raw = localStorage.getItem(STORAGE_KEY) ?? '{}';
    const blob = new Blob([raw], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = 'myvikey-export.json';
    document.body.appendChild(a);
    a.click();
    a.remove();

    URL.revokeObjectURL(url);
    setAdminStatus('Export complete.');
  });

  setAdminStatus('Admin panel ready');
})();
