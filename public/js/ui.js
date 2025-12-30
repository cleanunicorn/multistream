/**
 * UI Helper for Multistream
 * Handles sidebar injection and common UI interactions.
 */

const UI = {
    init: function () {
        this.injectSidebar();
        this.highlightCurrentPage();
    },

    injectSidebar: function () {
        // Only run if we are in the app structure
        if (!document.querySelector('.app-container')) {
            // Note: If the page doesn't have .app-container manually added, 
            // we might want to wrap the body content, but for now we assume 
            // the pages will be refactored to include it or we add it here.

            // Let's assume the body content needs to be wrapped
            const bodyContent = document.body.innerHTML;
            document.body.innerHTML = '';

            const appContainer = document.createElement('div');
            appContainer.className = 'app-container';

            const sidebar = document.createElement('aside');
            sidebar.className = 'sidebar';
            sidebar.className = 'sidebar';
            sidebar.innerHTML = `
                <div class="sidebar-header">
                    <div class="logo-text">Multistream</div>
                    <button id="sidebarToggle" class="btn-icon">
                        <span class="nav-icon">◀</span>
                    </button>
                </div>
                <nav class="nav-links">
                    <a href="/" class="nav-item" data-page="index">
                        <span class="nav-icon">📊</span> <span class="nav-text">Dashboard</span>
                    </a>
                    <a href="recordings.html" class="nav-item" data-page="recordings">
                        <span class="nav-icon">📹</span> <span class="nav-text">Recordings</span>
                    </a>
                    <a href="resources.html" class="nav-item" data-page="resources">
                        <span class="nav-icon">🖥️</span> <span class="nav-text">Resources</span>
                    </a>
                    <a href="settings.html" class="nav-item" data-page="settings">
                       <span class="nav-icon">⚙️</span> <span class="nav-text">Settings</span>
                    </a>
                </nav>
            `;

            const mainContent = document.createElement('main');
            mainContent.className = 'main-content';
            mainContent.innerHTML = bodyContent;

            appContainer.appendChild(sidebar);
            appContainer.appendChild(mainContent);
            document.body.appendChild(appContainer);

            // Init toggle listener and state
            setTimeout(() => {
                const toggleBtn = document.getElementById('sidebarToggle');
                if (toggleBtn) {
                    toggleBtn.addEventListener('click', () => this.toggleSidebar());
                }

                // Restore state
                const isCollapsed = localStorage.getItem('sidebar_collapsed') === 'true';
                if (isCollapsed) {
                    this.setSidebarState(true);
                }
            }, 0);
        }
    },

    toggleSidebar: function () {
        const sidebar = document.querySelector('.sidebar');
        const isCollapsed = sidebar.classList.contains('collapsed');
        this.setSidebarState(!isCollapsed);
    },

    setSidebarState: function (collapsed) {
        const sidebar = document.querySelector('.sidebar');
        const mainContent = document.querySelector('.main-content');
        const toggleBtnIcon = document.querySelector('#sidebarToggle span');

        if (collapsed) {
            sidebar.classList.add('collapsed');
            mainContent.classList.add('expanded');
            if (toggleBtnIcon) toggleBtnIcon.innerText = '▶';
            localStorage.setItem('sidebar_collapsed', 'true');
        } else {
            sidebar.classList.remove('collapsed');
            mainContent.classList.remove('expanded');
            if (toggleBtnIcon) toggleBtnIcon.innerText = '◀';
            localStorage.setItem('sidebar_collapsed', 'false');
        }
    },

    highlightCurrentPage: function () {
        const path = window.location.pathname;
        let pagename = path.split('/').pop() || 'index';
        if (pagename === 'index.html' || pagename === '') pagename = 'index';
        if (pagename.includes('recordings')) pagename = 'recordings';
        if (pagename.includes('resources')) pagename = 'resources';
        if (pagename.includes('settings')) pagename = 'settings';
        if (pagename.includes('settings')) pagename = 'settings';

        const navItems = document.querySelectorAll('.nav-item');
        navItems.forEach(item => {
            if (item.getAttribute('data-page') === pagename) {
                item.classList.add('active');
            }
        });
    },

    // Toast notification helper
    showToast: function (message, type = 'info') {
        let toastContainer = document.getElementById('toast-container');
        if (!toastContainer) {
            toastContainer = document.createElement('div');
            toastContainer.id = 'toast-container';
            toastContainer.style.cssText = `
                position: fixed;
                bottom: 20px;
                right: 20px;
                z-index: 1000;
                display: flex;
                flex-direction: column;
                gap: 10px;
            `;
            document.body.appendChild(toastContainer);
        }

        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;

        let color = '#3b82f6';
        if (type === 'success') color = '#10b981';
        if (type === 'error') color = '#ef4444';

        toast.style.cssText = `
            background: #181b21;
            border-left: 4px solid ${color};
            color: white;
            padding: 12px 20px;
            border-radius: 4px;
            box-shadow: 0 4px 6px rgba(0,0,0,0.3);
            min-width: 250px;
            opacity: 0;
            transform: translateY(20px);
            transition: all 0.3s ease;
        `;
        toast.innerText = message;

        toastContainer.appendChild(toast);

        // Animate in
        requestAnimationFrame(() => {
            toast.style.opacity = '1';
            toast.style.transform = 'translateY(0)';
        });

        // Remove after 3s
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(20px)';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }
};

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => UI.init());
