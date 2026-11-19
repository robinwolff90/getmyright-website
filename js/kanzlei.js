// GetMyRight Kanzlei-Bereich JavaScript

document.addEventListener('DOMContentLoaded', function() {
    console.log('Kanzlei-Bereich geladen');
    
    // Claim-Button Funktionalität
    const claimButtons = document.querySelectorAll('.claim-btn');
    claimButtons.forEach(button => {
        button.addEventListener('click', function() {
            const fallId = this.dataset.fallId;
            const kanzleiName = this.dataset.kanzleiName || 'Ihre Kanzlei';
            
            if (confirm(`Möchten Sie diesen Fall für ${kanzleiName} claimen?`)) {
                simulateFallClaim(fallId, kanzleiName);
            }
        });
    });
    
    // Ablehn-Button Funktionalität
    const rejectButtons = document.querySelectorAll('.reject-btn');
    rejectButtons.forEach(button => {
        button.addEventListener('click', function() {
            const fallId = this.dataset.fallId;
            if (confirm('Möchten Sie diesen Fall wirklich ablehnen? Der Fall wird danach automatisch wieder für andere Kanzleien sichtbar.')) {
                simulateFallRejection(fallId);
            }
        });
    });
    
    // Download-Button Funktionalität
    const downloadButtons = document.querySelectorAll('.download-btn');
    downloadButtons.forEach(button => {
        button.addEventListener('click', function() {
            const fallId = this.dataset.fallId;
            simulateDocumentDownload(fallId);
        });
    });
    
    // Filter und Sortierfunktionen
    initializeFilters();
});

// Simulation des Fall-Claims
function simulateFallClaim(fallId, kanzleiName) {
    const button = document.querySelector(`.claim-btn[data-fall-id="${fallId}"]`);
    const row = button.closest('tr');
    const originalText = button.textContent;
    button.textContent = 'Wird geclaimed...';
    button.disabled = true;
    
    // Simuliere API-Aufruf
    setTimeout(() => {
        button.textContent = 'Geclaimed';
        button.classList.remove('claim-btn');
        button.classList.add('claimed');
        button.disabled = true;
        
        // Aktualisiere Statusanzeige
        const statusCell = row.querySelector('td:nth-child(5) span');
        if (statusCell) {
            statusCell.textContent = 'von dir geclaimt';
            statusCell.className = 'px-2 py-1 rounded-full bg-violet-950/60 text-violet-300 text-xs font-medium';
        }
        
        // Aktualisiere Action-Zelle
        const actionCell = row.querySelector('td:last-child');
        if (actionCell) {
            actionCell.innerHTML = '<a href="#fall-details" class="px-3 py-1.5 rounded-lg border border-violet-800 text-violet-300 text-xs font-medium hover:bg-violet-950/60">Details ansehen</a>';
        }
        
        console.log(`Fall ${fallId} erfolgreich für ${kanzleiName} geclaimed`);
    }, 1500);
}

// Simulation der Fall-Ablehnung
function simulateFallRejection(fallId) {
    const button = document.querySelector(`.reject-btn[data-fall-id="${fallId}"]`);
    const row = button.closest('.fall-detail');
    const originalText = button.textContent;
    button.textContent = 'Wird abgelehnt...';
    button.disabled = true;
    
    // Simuliere API-Aufruf
    setTimeout(() => {
        button.textContent = 'Abgelehnt';
        button.disabled = true;
        
        // Zeige Erfolgsmeldung
        const successMessage = document.createElement('div');
        successMessage.className = 'success-message';
        successMessage.textContent = 'Fall erfolgreich abgelehnt. Der Fall ist nun für andere Kanzleien wieder sichtbar.';
        successMessage.style.color = '#10b981';
        successMessage.style.marginTop = '1rem';
        successMessage.style.padding = '0.75rem';
        successMessage.style.borderRadius = '0.5rem';
        successMessage.style.backgroundColor = 'rgba(16, 185, 129, 0.1)';
        successMessage.style.border = '1px solid rgba(16, 185, 129, 0.3)';
        
        row.appendChild(successMessage);
        
        console.log(`Fall ${fallId} erfolgreich abgelehnt`);
    }, 1500);
}

// Simulation des Dokumenten-Downloads
function simulateDocumentDownload(fallId) {
    const button = document.querySelector(`.download-btn[data-fall-id="${fallId}"]`);
    const originalText = button.textContent;
    button.textContent = 'Wird heruntergeladen...';
    button.disabled = true;
    
    // Simuliere Download
    setTimeout(() => {
        button.textContent = '✓ Heruntergeladen';
        
        // Zeige Download-Link
        const downloadLink = document.createElement('a');
        downloadLink.href = '#';
        downloadLink.download = `fall-${fallId}-dokumente.zip`;
        downloadLink.textContent = ' Dokumente.zip';
        downloadLink.style.display = 'block';
        downloadLink.style.marginTop = '0.5rem';
        downloadLink.style.color = '#8b5cf6';
        downloadLink.style.textDecoration = 'underline';
        
        button.parentNode.appendChild(downloadLink);
        
        console.log(`Dokumente für Fall ${fallId} heruntergeladen`);
    }, 2000);
}

// Initialisierung der Filter
function initializeFilters() {
    // Region Filter
    const regionFilter = document.getElementById('region-filter');
    if (regionFilter) {
        regionFilter.addEventListener('change', filterTable);
    }
    
    // Status Filter
    const statusFilter = document.getElementById('status-filter');
    if (statusFilter) {
        statusFilter.addEventListener('change', filterTable);
    }
    
    // Suchfeld
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        searchInput.addEventListener('input', filterTable);
    }
}

// Tabellenfilterung
function filterTable() {
    const regionFilter = document.getElementById('region-filter')?.value || '';
    const statusFilter = document.getElementById('status-filter')?.value || '';
    const searchQuery = document.getElementById('search-input')?.value.toLowerCase() || '';
    
    const tableRows = document.querySelectorAll('tbody tr');
    tableRows.forEach(row => {
        const region = row.cells[1]?.textContent.toLowerCase() || '';
        const status = row.cells[4]?.textContent.toLowerCase() || '';
        const uuid = row.cells[0]?.textContent.toLowerCase() || '';
        
        const regionMatch = !regionFilter || region.includes(regionFilter.toLowerCase());
        const statusMatch = !statusFilter || status.includes(statusFilter.toLowerCase());
        const searchMatch = !searchQuery || 
            region.includes(searchQuery) || 
            status.includes(searchQuery) || 
            uuid.includes(searchQuery);
        
        if (regionMatch && statusMatch && searchMatch) {
            row.style.display = '';
        } else {
            row.style.display = 'none';
        }
    });
}

// Pagination (falls benötigt)
function setupPagination() {
    const pagination = document.querySelector('.pagination');
    if (!pagination) return;
    
    const rowsPerPage = 10;
    const rows = Array.from(document.querySelectorAll('tbody tr'));
    const totalPages = Math.ceil(rows.length / rowsPerPage);
    
    // Erstelle Seitenzahlen
    for (let i = 1; i <= totalPages; i++) {
        const pageButton = document.createElement('button');
        pageButton.textContent = i;
        pageButton.className = 'page-btn';
        pageButton.addEventListener('click', () => showPage(i, rowsPerPage));
        pagination.appendChild(pageButton);
    }
    
    // Zeige erste Seite
    showPage(1, rowsPerPage);
}

// Seite anzeigen
function showPage(page, rowsPerPage) {
    const rows = Array.from(document.querySelectorAll('tbody tr'));
    const startIndex = (page - 1) * rowsPerPage;
    const endIndex = startIndex + rowsPerPage;
    
    rows.forEach((row, index) => {
        if (index >= startIndex && index < endIndex) {
            row.style.display = '';
        } else {
            row.style.display = 'none';
        }
    });
    
    // Aktive Seite markieren
    document.querySelectorAll('.page-btn').forEach((btn, index) => {
        if (index + 1 === page) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
}