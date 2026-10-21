document.addEventListener('DOMContentLoaded', async () => {
    const container = document.getElementById('card-container');
    const hash = window.location.hash.replace('#', '') || 'alex';

    try {
        const response = await fetch(`/api/card?id=${hash}`);
        if (!response.ok) throw new Error("Card not found");
        const profile = await response.json();

        container.innerHTML = `
            <img src="${profile.avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=300&q=80'}" class="w-24 h-24 rounded-full object-cover border-2 border-purple-500/50 shadow-lg mx-auto mb-3">
            <h1 class="text-xl font-bold text-white mb-1">${profile.name || 'Unnamed'}</h1>
            <p class="text-xs text-gray-300 mb-6">${profile.bio || ''}</p>
            
            <div class="space-y-3 mb-6">
                ${(profile.links || []).map(l => `
                    <a href="${l.url}" target="_blank" class="flex items-center justify-between p-3.5 rounded-2xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-purple-500/50 transition">
                        <span>${l.icon || '🔗'}</span>
                        <span class="flex-1 text-sm font-medium text-gray-200">${l.title}</span>
                    </a>
                `).join('')}
            </div>
            
            <div class="text-[10px] text-gray-500 uppercase tracking-widest pt-2 border-t border-white/5 font-mono">
                Powered by V I Key®
            </div>
        `;
    } catch (e) {
        container.innerHTML = `<p class="text-xs text-red-400 py-6">Profile "${hash}" could not be loaded.</p>`;
    }
});
