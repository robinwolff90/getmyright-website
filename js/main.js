// GetMyRight Haupt-JavaScript

// DOM geladen Event
document.addEventListener('DOMContentLoaded', function() {
    console.log('GetMyRight loaded successfully');
    
    // Mobile Navigation Toggle
    const mobileToggle = document.createElement('button');
    mobileToggle.innerHTML = '☰';
    mobileToggle.classList.add('mobile-toggle');
    mobileToggle.setAttribute('aria-label', 'Toggle navigation');
    
    const header = document.querySelector('header');
    if (header) {
        header.appendChild(mobileToggle);
    }
    
    mobileToggle.addEventListener('click', function() {
        const nav = document.querySelector('nav ul');
        if (nav) {
            nav.classList.toggle('show');
        }
    });
    
    // Smooth Scrolling für Anchor Links
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            const target = document.querySelector(this.getAttribute('href'));
            if (target) {
                target.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });
            }
        });
    });
    
    // Aktive Navigationslinks aktualisieren
    const sections = document.querySelectorAll('section');
    const navLinks = document.querySelectorAll('nav a');
    
    window.addEventListener('scroll', function() {
        let current = '';
        
        sections.forEach(section => {
            const sectionTop = section.offsetTop;
            if (window.pageYOffset >= sectionTop - 60) {
                current = section.getAttribute('id');
            }
        });
        
        navLinks.forEach(link => {
            link.classList.remove('active');
            if (link.getAttribute('href') === `#${current}`) {
                link.classList.add('active');
            }
        });
    });
    
    // Hinweis: Formulare werden nicht mehr simuliert abgeschickt.
    // Warteliste/Registrierung übernimmt js/gmr-forms.js (echte Übermittlung an Brevo bzw. per E-Mail).
});

// Utility Functions

// Formatierung von Währungsbeträgen
function formatCurrency(amount) {
    return new Intl.NumberFormat('de-DE', {
        style: 'currency',
        currency: 'EUR'
    }).format(amount);
}

// Formatierung von Datumsangaben
function formatDate(dateString) {
    const options = { 
        year: 'numeric', 
        month: '2-digit', 
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    };
    return new Date(dateString).toLocaleDateString('de-DE', options);
}

// UUID Generator (für Demo-Zwecke)
function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// Local Storage Helper
const storage = {
    set: function(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
            return true;
        } catch (e) {
            console.error('LocalStorage set error:', e);
            return false;
        }
    },
    
    get: function(key, defaultValue = null) {
        try {
            const item = localStorage.getItem(key);
            return item ? JSON.parse(item) : defaultValue;
        } catch (e) {
            console.error('LocalStorage get error:', e);
            return defaultValue;
        }
    },
    
    remove: function(key) {
        try {
            localStorage.removeItem(key);
            return true;
        } catch (e) {
            console.error('LocalStorage remove error:', e);
            return false;
        }
    }
};

// Export für andere Module
window.GetMyRight = {
    formatCurrency,
    formatDate,
    generateUUID,
    storage
};