// GetMyRight Admin-Bereich JavaScript

document.addEventListener('DOMContentLoaded', function() {
    console.log('Admin-Bereich geladen');
    
    // Unblock-Button Funktionalität
    const unblockButtons = document.querySelectorAll('.unblock-btn');
    unblockButtons.forEach(button => {
        button.addEventListener('click', function() {
            const fallId = this.dataset.fallId;
            if (confirm('Möchten Sie diesen Fall wirklich manuell entsperren?')) {
                simulateFallUnblock(fallId);
            }
        });
    });
    
    // Checkbox Funktionalität für sichtbare Felder
    const fieldCheckboxes = document.querySelectorAll('.field-checkbox');
    fieldCheckboxes.forEach(checkbox => {
        checkbox.addEventListener('change', function() {
            const fieldName = this.dataset.fieldName;
            const isVisible = this.checked;
            simulateFieldVisibilityUpdate(fieldName, isVisible);
        });
    });
    
    // Kanzlei Status Toggle
    const statusToggles = document.querySelectorAll('.status-toggle');
    statusToggles.forEach(toggle => {
        toggle.addEventListener('change', function() {
            const kanzleiId = this.dataset.kanzleiId;
            const isActive = this.checked;
            simulateKanzleiStatusUpdate(kanzleiId, isActive);
        });
    });
    
    // Export-Funktionen
    const exportButtons = document.querySelectorAll('.export-btn');
    exportButtons.forEach(button => {
        button.addEventListener('click', function() {
            const exportType = this.dataset.exportType;
            simulateExport(exportType);
        });
    });
});

// Simulation der Fall-Entsperrung
function simulateFallUnblock(fallId) {
    const button = document.querySelector(`.unblock-btn[data-fall-id="${fallId}"]`);
    const row = button.closest('tr');
    const originalText = button.textContent;
    button.textContent = 'Wird entsperrt...';
    button.disabled = true;
    
    // Simuliere API-Aufruf
    setTimeout(() => {
        button.textContent = 'Entsperrt';
        button.disabled = true;
        
        // Aktualisiere Statusanzeige
        const statusCell = row.querySelector('td:nth-child(2) span');
        if (statusCell) {
            statusCell.textContent = 'offen';
            statusCell.className = 'px-2 py-1 rounded-full bg-emerald-950/60 text-emerald-300 text-xs font-medium';
        }
        
        // Zeige Erfolgsmeldung
        const successMessage = document.createElement('div');
        successMessage.className = 'success-message';
        successMessage.textContent = 'Fall erfolgreich entsperrt und wieder für Kanzleien sichtbar.';
        successMessage.style.color = '#10b981';
        successMessage.style.marginTop = '0.5rem';
        successMessage.style.padding = '0.5rem';
        successMessage.style.borderRadius = '0.25rem';
        successMessage.style.backgroundColor = 'rgba(16, 185, 129, 0.1)';
        
        row.querySelector('td:last-child').appendChild(successMessage);
        
        console.log(`Fall ${fallId} erfolgreich entsperrt`);
    }, 1500);
}

// Simulation der Feldsichtbarkeit Aktualisierung
function simulateFieldVisibilityUpdate(fieldName, isVisible) {
    // Simuliere API-Aufruf
    setTimeout(() => {
        console.log(`Feld '${fieldName}' Sichtbarkeit aktualisiert zu: ${isVisible ? 'sichtbar' : 'ausgeblendet'}`);
        
        // Zeige visuelles Feedback
        const checkbox = document.querySelector(`.field-checkbox[data-field-name="${fieldName}"]`);
        if (checkbox) {
            checkbox.parentElement.style.backgroundColor = isVisible ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)';
            setTimeout(() => {
                checkbox.parentElement.style.backgroundColor = '';
            }, 1000);
        }
    }, 500);
}

// Simulation der Kanzlei-Status Aktualisierung
function simulateKanzleiStatusUpdate(kanzleiId, isActive) {
    // Simuliere API-Aufruf
    setTimeout(() => {
        console.log(`Kanzlei ${kanzleiId} Status aktualisiert zu: ${isActive ? 'aktiv' : 'inaktiv'}`);
        
        // Aktualisiere Statusanzeige
        const statusCell = document.querySelector(`.kanzlei-status[data-kanzlei-id="${kanzleiId}"]`);
        if (statusCell) {
            statusCell.innerHTML = isActive ? 
                '<span class="px-2 py-1 rounded-full bg-emerald-950/60 text-emerald-300 text-xs font-medium">aktiv</span>' :
                '<span class="px-2 py-1 rounded-full bg-slate-800 text-slate-400 text-xs font-medium">inaktiv</span>';
        }
    }, 500);
}

// Simulation des Exports
function simulateExport(exportType) {
    const button = document.querySelector(`.export-btn[data-export-type="${exportType}"]`);
    const originalText = button.textContent;
    button.textContent = 'Wird exportiert...';
    button.disabled = true;
    
    // Simuliere Exportprozess
    setTimeout(() => {
        button.textContent = 'Exportiert ✓';
        
        // Zeige Download-Link
        const downloadLink = document.createElement('a');
        downloadLink.href = '#';
        downloadLink.download = `export-${exportType}-${new Date().toISOString().slice(0, 10)}.csv`;
        downloadLink.textContent = ` ${exportType}-export.csv`;
        downloadLink.style.display = 'inline-block';
        downloadLink.style.marginLeft = '0.5rem';
        downloadLink.style.color = '#0ea5e9';
        downloadLink.style.textDecoration = 'underline';
        
        button.parentNode.appendChild(downloadLink);
        
        console.log(`${exportType} Export abgeschlossen`);
        
        // Reset Button nach 3 Sekunden
        setTimeout(() => {
            button.textContent = originalText;
            button.disabled = false;
        }, 3000);
    }, 2000);
}

// Statistik-Dashboard
function initializeDashboard() {
    // Hole Statistikdaten (simuliert)
    const stats = {
        totalFaelle: 142,
        offeneFaelle: 28,
        geclaimteFaelle: 89,
        abgeschlosseneFaelle: 25,
        aktiveKanzleien: 12,
        neueFaelleLetzte7Tage: 7
    };
    
    // Aktualisiere Dashboard-Karten
    document.querySelectorAll('.stat-card').forEach(card => {
        const statType = card.dataset.statType;
        if (stats[statType]) {
            const valueElement = card.querySelector('.stat-value');
            if (valueElement) {
                valueElement.textContent = stats[statType];
            }
        }
    });
}

// Benachrichtigungs-System
function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    
    // Styling basierend auf Typ
    const colors = {
        info: '#0ea5e9',
        success: '#10b981',
        warning: '#f59e0b',
        error: '#ef4444'
    };
    
    notification.style.position = 'fixed';
    notification.style.top = '20px';
    notification.style.right = '20px';
    notification.style.padding = '1rem';
    notification.style.borderRadius = '0.5rem';
    notification.style.backgroundColor = '#1e293b';
    notification.style.color = colors[type] || colors.info;
    notification.style.border = `1px solid ${colors[type] || colors.info}`;
    notification.style.zIndex = '1000';
    notification.style.boxShadow = '0 4px 6px rgba(0, 0, 0, 0.1)';
    
    document.body.appendChild(notification);
    
    // Automatisch entfernen nach 5 Sekunden
    setTimeout(() => {
        if (notification.parentNode) {
            notification.parentNode.removeChild(notification);
        }
    }, 5000);
}

// Initialisiere Dashboard wenn vorhanden
document.addEventListener('DOMContentLoaded', function() {
    if (document.querySelector('.dashboard')) {
        initializeDashboard();
    }
});