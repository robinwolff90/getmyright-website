// GetMyRight Spieler-Bereich JavaScript

document.addEventListener('DOMContentLoaded', function() {
    console.log('Spieler-Bereich geladen');
    
    // Status-Anzeige Aktualisierung
    const statusElements = document.querySelectorAll('.status-indicator');
    statusElements.forEach(element => {
        const status = element.dataset.status;
        switch(status) {
            case 'offen':
                element.style.backgroundColor = '#10b981'; // emerald
                break;
            case 'geclaimt':
                element.style.backgroundColor = '#8b5cf6'; // violet
                break;
            case 'abgelehnt':
                element.style.backgroundColor = '#ef4444'; // red
                break;
            case 'wiederaufgenommen':
                element.style.backgroundColor = '#f59e0b'; // amber
                break;
        }
    });
    
    // Fall-Zurückziehen Funktion
    const withdrawButtons = document.querySelectorAll('.withdraw-btn');
    withdrawButtons.forEach(button => {
        button.addEventListener('click', function() {
            const fallId = this.dataset.fallId;
            if (confirm('Möchten Sie diesen Fall wirklich dauerhaft zurückziehen? Dies kann nicht rückgängig gemacht werden.')) {
                // Hier würde normalerweise ein API-Aufruf stattfinden
                simulateFallWithdrawal(fallId);
            }
        });
    });
    
    // Magic Link Login Simulation
    const magicLinkForm = document.getElementById('magic-link-form');
    if (magicLinkForm) {
        magicLinkForm.addEventListener('submit', function(e) {
            e.preventDefault();
            const email = document.getElementById('email').value;
            simulateMagicLinkLogin(email);
        });
    }
});

// Simulation des Fall-Zurückziehens
function simulateFallWithdrawal(fallId) {
    const button = document.querySelector(`.withdraw-btn[data-fall-id="${fallId}"]`);
    const originalText = button.textContent;
    button.textContent = 'Wird zurückgezogen...';
    button.disabled = true;
    
    // Simuliere API-Aufruf
    setTimeout(() => {
        button.textContent = 'Zurückgezogen';
        button.classList.add('withdrawn');
        
        // Aktualisiere Statusanzeige
        const statusElement = document.querySelector(`.status-${fallId}`);
        if (statusElement) {
            statusElement.textContent = 'Zurückgezogen';
            statusElement.className = 'status-indicator withdrawn';
        }
        
        console.log(`Fall ${fallId} erfolgreich zurückgezogen`);
    }, 2000);
}

// Simulation des Magic Link Logins
function simulateMagicLinkLogin(email) {
    const submitButton = document.querySelector('#magic-link-form button');
    const originalText = submitButton.textContent;
    submitButton.textContent = 'Wird gesendet...';
    submitButton.disabled = true;
    
    // Simuliere API-Aufruf
    setTimeout(() => {
        submitButton.textContent = 'Link gesendet!';
        
        // Zeige Erfolgsmeldung
        const successMessage = document.createElement('div');
        successMessage.className = 'success-message';
        successMessage.textContent = `Ein Login-Link wurde an ${email} gesendet.`;
        successMessage.style.color = '#10b981';
        successMessage.style.marginTop = '1rem';
        successMessage.style.padding = '0.5rem';
        successMessage.style.borderRadius = '0.25rem';
        successMessage.style.backgroundColor = 'rgba(16, 185, 129, 0.1)';
        
        document.getElementById('magic-link-form').appendChild(successMessage);
        
        // Reset nach 3 Sekunden
        setTimeout(() => {
            submitButton.textContent = originalText;
            submitButton.disabled = false;
        }, 3000);
    }, 1500);
}

// Status-Verlauf Animation
function animateTimeline() {
    const timelineItems = document.querySelectorAll('.timeline-item');
    timelineItems.forEach((item, index) => {
        setTimeout(() => {
            item.style.opacity = '1';
            item.style.transform = 'translateY(0)';
        }, index * 200);
    });
}

// Initialisiere Timeline-Animation wenn vorhanden
document.addEventListener('DOMContentLoaded', function() {
    if (document.querySelector('.timeline')) {
        animateTimeline();
    }
});