/*
 * ============================
 * SISTEMA WHATSAPP MASIVO - JS
 * ============================
 */

// Configuración CSRF para Laravel
$.ajaxSetup({
    headers: {
        'X-CSRF-TOKEN': $('meta[name="csrf-token"]').attr('content')
    }
});

// ============================
// VARIABLES GLOBALES
// ============================

let loadedContacts = [];
let isWhatsAppReady = false;
let isProcessing = false;
let isPaused = false;
let shouldStop = false;
let currentBatch = 0;
let processedMessages = 0;
let successfulMessages = 0;
let failedMessages = 0;
let allResults = [];
let startTime = null;
let totalBatches = 0;

// Configuración del sistema
const CONFIG = {
    maxContactsPerFile: 10000,
    defaultBatchSize: 100,
    defaultDelayBetweenMessages: 2,
    defaultDelayBetweenBatches: 10,
    maxRetries: 3,
    connectionCheckInterval: 30000,
    progressUpdateInterval: 1000
};

// ============================
// FUNCIONES DE CONEXIÓN
// ============================

function checkConnectionStatus() {
    if (isProcessing) return;
    
    $.get('/whatsapp/status')
        .done(function(data) {
            isWhatsAppReady = data.ready;
            updateConnectionDisplay(data.ready);
            updateBulkButton();
        })
        .fail(function(xhr) {
            isWhatsAppReady = false;
            updateConnectionDisplay(false, 'Error de conexión con el servidor');
            updateBulkButton();
            
            if (!window.connectionErrorShown) {
                window.connectionErrorShown = true;
                Swal.fire({
                    icon: 'error',
                    title: 'Sin Conexión',
                    text: 'No se puede conectar con la API de WhatsApp. Verifica que esté ejecutándose.',
                    timer: 3000,
                    showConfirmButton: false,
                    position: 'top-end',
                    toast: true
                });
                setTimeout(() => { window.connectionErrorShown = false; }, 60000);
            }
        });
}

function updateConnectionDisplay(isReady, errorMessage = '') {
    const statusElement = $('#connection-status');
    
    if (isReady) {
        statusElement.html(`
            <span class="status-indicator status-connected"></span>
            Conectado y listo
        `).removeClass('bg-light text-dark').addClass('bg-success text-white');
        
        if (!window.connectionNotified) {
            window.connectionNotified = true;
            Swal.fire({
                icon: 'success',
                title: 'WhatsApp Conectado',
                text: 'La conexión con WhatsApp está activa y lista',
                timer: 2000,
                showConfirmButton: false,
                position: 'top-end',
                toast: true
            });
        }
    } else {
        statusElement.html(`
            <span class="status-indicator status-disconnected"></span>
            ${errorMessage || 'Desconectado - Verificar código QR'}
        `).removeClass('bg-success text-white').addClass('bg-light text-dark');
        window.connectionNotified = false;
    }
}

// ============================
// FUNCIONES DE VALIDACIÓN
// ============================

function updateBulkButton() {
    const btn = $('#sendBulkBtn');
    const hasContacts = loadedContacts.length > 0;
    const hasMessage = $('#messageTemplate').val().trim().length > 0;
    
    if (isWhatsAppReady && hasContacts && hasMessage && !isProcessing) {
        btn.prop('disabled', false)
           .removeClass('btn-secondary')
           .addClass('btn-success')
           .html('<i class="fas fa-rocket me-2"></i>Iniciar Envío Masivo');
    } else {
        btn.prop('disabled', true)
           .removeClass('btn-success')
           .addClass('btn-secondary');
        
        let reason = '';
        if (isProcessing) {
            reason = 'Procesando...';
        } else if (!isWhatsAppReady) {
            reason = 'WhatsApp no conectado';
        } else if (!hasContacts) {
            reason = 'Cargar archivo Excel';
        } else if (!hasMessage) {
            reason = 'Escribir mensaje';
        }
        
        btn.html(`<i class="fas fa-ban me-2"></i>${reason}`);
    }
}

// ============================
// MENSAJE INDIVIDUAL
// ============================

function initializeSingleMessage() {
    $('#singleMessageForm').submit(function(e) {
        e.preventDefault();
        
        const btn = $('#sendSingleBtn');
        const originalText = btn.html();
        btn.prop('disabled', true).html('<div class="custom-spinner"></div>Enviando...');
        
        $.post('/whatsapp/send-single', {
            phone: $('#phone').val(),
            message: $('#message').val()
        })
        .done(function(data) {
            if (data.success) {
                Swal.fire({
                    icon: 'success',
                    title: '¡Mensaje Enviado!',
                    text: 'El mensaje se envió correctamente',
                    timer: 2000,
                    showConfirmButton: false,
                    position: 'top-end',
                    toast: true
                });
                $('#singleMessageForm')[0].reset();
                updateCharCount();
            } else {
                Swal.fire({
                    icon: 'error',
                    title: 'Error al Enviar',
                    text: data.message,
                    confirmButtonText: 'Entendido'
                });
            }
        })
        .fail(function(xhr) {
            let errorMessage = 'Error de conexión con el servidor';
            try {
                const response = JSON.parse(xhr.responseText);
                errorMessage = response.message || errorMessage;
            } catch (e) {
                // Mantener mensaje por defecto
            }
            
            Swal.fire({
                icon: 'error',
                title: 'Error de Conexión',
                text: errorMessage,
                confirmButtonText: 'Reintentar'
            });
        })
        .always(function() {
            btn.prop('disabled', false).html(originalText);
        });
    });

    // Contador de caracteres para mensaje individual
    $('#message').on('input', updateCharCount);
}

function updateCharCount() {
    const currentLength = $('#message').val().length;
    $('#charCount').text(`${currentLength}/4000`);
    
    if (currentLength > 3500) {
        $('#charCount').addClass('text-warning');
    } else if (currentLength > 3800) {
        $('#charCount').addClass('text-danger').removeClass('text-warning');
    } else {
        $('#charCount').removeClass('text-warning text-danger');
    }
}

// ============================
// CARGA DE EXCEL
// ============================

function initializeExcelUpload() {
    $('#excelUploadForm').submit(function(e) {
        e.preventDefault();
        
        const btn = $('#uploadBtn');
        const originalText = btn.html();
        btn.prop('disabled', true).html('<div class="custom-spinner"></div>Procesando archivo...');
        
        const formData = new FormData();
        formData.append('excel_file', $('#excel_file')[0].files[0]);
        
        $.ajax({
            url: '/whatsapp/upload-excel',
            type: 'POST',
            data: formData,
            processData: false,
            contentType: false,
            timeout: 120000, // 2 minutos
            success: function(data) {
                if (data.success) {
                    loadedContacts = data.contacts;
                    
                    if (loadedContacts.length > CONFIG.maxContactsPerFile) {
                        Swal.fire({
                            icon: 'warning',
                            title: 'Archivo Muy Grande',
                            text: `El archivo tiene ${loadedContacts.length} contactos. Se procesarán solo los primeros ${CONFIG.maxContactsPerFile} para optimizar el rendimiento.`,
                            confirmButtonText: 'Entendido'
                        });
                        loadedContacts = loadedContacts.slice(0, CONFIG.maxContactsPerFile);
                    }
                    
                    displayContacts(loadedContacts);
                    calculateBatches();
                    updateBulkButton();
                    $('#batchControls').slideDown();
                    
                    Swal.fire({
                        icon: 'success',
                        title: '¡Archivo Procesado!',
                        html: `
                            <div class="text-start">
                                <p><strong>Contactos cargados:</strong> ${loadedContacts.length}</p>
                                <p><strong>Filas omitidas:</strong> ${data.skipped}</p>
                                <p><strong>Lotes generados:</strong> ${Math.ceil(loadedContacts.length / CONFIG.defaultBatchSize)}</p>
                            </div>
                        `,
                        timer: 4000,
                        showConfirmButton: false,
                        position: 'top-end',
                        toast: true
                    });
                } else {
                    Swal.fire({
                        icon: 'error',
                        title: 'Error Procesando Excel',
                        text: data.message,
                        confirmButtonText: 'Entendido'
                    });
                    loadedContacts = [];
                    $('#batchControls').slideUp();
                    updateBulkButton();
                }
            },
            error: function(xhr, status, error) {
                let errorMessage = 'Error procesando el archivo Excel';
                
                if (status === 'timeout') {
                    errorMessage = 'El archivo tardó mucho en procesarse. Intenta con un archivo más pequeño.';
                } else if (xhr.responseJSON && xhr.responseJSON.message) {
                    errorMessage = xhr.responseJSON.message;
                }
                
                Swal.fire({
                    icon: 'error',
                    title: 'Error de Procesamiento',
                    text: errorMessage,
                    confirmButtonText: 'Entendido'
                });
                
                loadedContacts = [];
                $('#batchControls').slideUp();
                updateBulkButton();
            }
        }).always(function() {
            btn.prop('disabled', false).html(originalText);
        });
    });
}

// ============================
// VISUALIZACIÓN DE CONTACTOS
// ============================

function displayContacts(contacts) {
    $('#contactsCount').text(contacts.length);
    
    let html = '';
    const previewLimit = 10;
    contacts.slice(0, previewLimit).forEach(function(contact, index) {
        html += `
            <div class="border-bottom py-2 d-flex justify-content-between align-items-center">
                <div>
                    <strong class="text-primary">${contact.name}</strong>
                    <div class="text-muted small">${contact.phone}</div>
                </div>
                <div>
                    ${contact.value ? `<span class="badge bg-info">${contact.value}</span>` : ''}
                </div>
            </div>
        `;
    });
    
    if (contacts.length > previewLimit) {
        html += `
            <div class="text-center text-muted mt-3 py-2">
                <i class="fas fa-ellipsis-h me-2"></i>
                y ${contacts.length - previewLimit} contactos más
            </div>
        `;
    }
    
    $('#contactsList').html(html);
    $('#contactsPreview').slideDown();
}

// ============================
// CÁLCULOS DE LOTES
// ============================

function calculateBatches() {
    const batchSize = parseInt($('#batchSize').val()) || CONFIG.defaultBatchSize;
    totalBatches = Math.ceil(loadedContacts.length / batchSize);
    $('#batchesCount').text(totalBatches);
    updateTimeEstimate();
}

function updateTimeEstimate() {
    const batchSize = parseInt($('#batchSize').val()) || CONFIG.defaultBatchSize;
    const delayBetweenMessages = parseInt($('#delayBetweenMessages').val()) || CONFIG.defaultDelayBetweenMessages;
    const delayBetweenBatches = parseInt($('#delayBetweenBatches').val()) || CONFIG.defaultDelayBetweenBatches;
    
    if (loadedContacts.length === 0) {
        $('#estimatedTime').text('Carga contactos primero');
        return;
    }
    
    const totalMessages = loadedContacts.length;
    const numBatches = Math.ceil(totalMessages / batchSize);
    
    // Cálculo: (mensajes × delay) + (lotes × delay entre lotes) + tiempo de procesamiento
    const totalTimeSeconds = (totalMessages * delayBetweenMessages) + (numBatches * delayBetweenBatches) + (totalMessages * 1);
    
    const hours = Math.floor(totalTimeSeconds / 3600);
    const minutes = Math.floor((totalTimeSeconds % 3600) / 60);
    
    let estimateText = '';
    if (hours > 0) {
        estimateText = `${hours}h ${minutes}m`;
    } else {
        estimateText = `${minutes}m`;
    }
    
    $('#estimatedTime').text(estimateText);
}

// ============================
// ENVÍO MASIVO
// ============================

function initializeBulkSending() {
    $('#sendBulkBtn').click(function() {
        if (loadedContacts.length === 0) {
            Swal.fire({
                icon: 'warning',
                title: 'Sin Contactos',
                text: 'Primero debes cargar un archivo Excel con contactos',
                confirmButtonText: 'Entendido'
            });
            return;
        }

        const batchSize = parseInt($('#batchSize').val());
        const estimatedTime = $('#estimatedTime').text();
        
        Swal.fire({
            icon: 'question',
            title: 'Confirmar Envío Masivo',
            html: `
                <div class="text-start">
                    <div class="alert alert-info">
                        <strong><i class="fas fa-info-circle me-2"></i>Configuración del Envío:</strong>
                    </div>
                    <ul class="list-unstyled">
                        <li><strong>📱 Contactos:</strong> ${loadedContacts.length}</li>
                        <li><strong>📦 Lotes:</strong> ${totalBatches} (${batchSize} mensajes/lote)</li>
                        <li><strong>⏱️ Tiempo estimado:</strong> ${estimatedTime}</li>
                        <li><strong>⏳ Delay entre mensajes:</strong> ${$('#delayBetweenMessages').val()}s</li>
                        <li><strong>⏸️ Delay entre lotes:</strong> ${$('#delayBetweenBatches').val()}s</li>
                        <li><strong>🔄 Auto-retry:</strong> ${$('#autoRetry').is(':checked') ? 'Activado' : 'Desactivado'}</li>
                    </ul>
                    <div class="alert alert-warning mt-3">
                        <small><i class="fas fa-exclamation-triangle me-1"></i>
                        Una vez iniciado, podrás pausar, reanudar o detener el proceso en cualquier momento.</small>
                    </div>
                </div>
            `,
            showCancelButton: true,
            confirmButtonText: '<i class="fas fa-rocket me-2"></i>Sí, Iniciar Envío',
            cancelButtonText: '<i class="fas fa-times me-2"></i>Cancelar',
            confirmButtonColor: '#28a745',
            cancelButtonColor: '#6c757d',
            width: 700,
            customClass: {
                popup: 'swal-wide'
            }
        }).then((result) => {
            if (result.isConfirmed) {
                startBulkSending();
            }
        });
    });
}

async function startBulkSending() {
    // Inicializar variables
    isProcessing = true;
    isPaused = false;
    shouldStop = false;
    currentBatch = 0;
    processedMessages = 0;
    successfulMessages = 0;
    failedMessages = 0;
    allResults = [];
    startTime = new Date();
    
    // Configuración
    const batchSize = parseInt($('#batchSize').val());
    const delayBetweenMessages = parseInt($('#delayBetweenMessages').val()) * 1000;
    const delayBetweenBatches = parseInt($('#delayBetweenBatches').val()) * 1000;
    
    // Actualizar UI
    updateBulkButton();
    showProcessingControls();
    $('#advancedProgress').slideDown();
    updateConnectionDisplay(true, 'Procesando envío masivo...');
    
    // Mostrar notificación de inicio (NO modal)
    Swal.fire({
        icon: 'info',
        title: 'Envío Iniciado',
        text: `Iniciando envío de ${loadedContacts.length} mensajes...`,
        timer: 2000,
        showConfirmButton: false,
        position: 'top-end',
        toast: true
    });

    try {
        // Dividir contactos en lotes
        const batches = [];
        for (let i = 0; i < loadedContacts.length; i += batchSize) {
            batches.push(loadedContacts.slice(i, i + batchSize));
        }
        
        // Inicializar progreso
        totalBatches = batches.length;
        updateProgress();
        
        // Procesar cada lote
        for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
            if (shouldStop) break;
            
            currentBatch = batchIndex + 1;
            const batch = batches[batchIndex];
            
            updateCurrentBatchInfo(currentBatch, totalBatches, 0, batch.length);
            
            // Procesar mensajes del lote
            await processBatch(batch, delayBetweenMessages);
            
            // Delay entre lotes (excepto el último)
            if (batchIndex < batches.length - 1 && !shouldStop) {
                await sleep(delayBetweenBatches);
            }
            
            // Manejar pausa
            while (isPaused && !shouldStop) {
                await sleep(1000);
            }
        }
        
        finalizeBulkSending();
        
    } catch (error) {
        console.error('Error en envío masivo:', error);
        Swal.fire({
            icon: 'error',
            title: 'Error Crítico',
            text: 'Ocurrió un error durante el envío masivo: ' + error.message,
            confirmButtonText: 'Entendido'
        });
        finalizeBulkSending();
    }
}

async function processBatch(batch, delayBetweenMessages) {
    for (let i = 0; i < batch.length; i++) {
        if (shouldStop) break;
        
        const contact = batch[i];
        
        try {
            // Personalizar mensaje
            const personalizedMessage = $('#messageTemplate').val()
                .replace(/{nombre}/g, contact.name)
                .replace(/{valor}/g, contact.value || '');
            
            // Enviar mensaje
            const result = await sendSingleMessageInternal(contact, personalizedMessage);
            
            allResults.push(result);
            
            if (result.success) {
                successfulMessages++;
            } else {
                failedMessages++;
            }
            
            processedMessages++;
            
            // Actualizar progreso
            updateProgress();
            updateCurrentBatchInfo(currentBatch, totalBatches, i + 1, batch.length);
            updateRealTimeStats();
            
            // Delay entre mensajes (excepto el último del lote)
            if (i < batch.length - 1 && !shouldStop) {
                await sleep(delayBetweenMessages);
            }
            
            // Manejar pausa
            while (isPaused && !shouldStop) {
                await sleep(1000);
            }
            
        } catch (error) {
            console.error('Error procesando contacto:', error);
            
            allResults.push({
                name: contact.name,
                phone: contact.phone,
                success: false,
                message: 'Error interno: ' + error.message,
                attempts: 1
            });
            
            failedMessages++;
            processedMessages++;
        }
    }
}

async function sendSingleMessageInternal(contact, message) {
    try {
        const response = await $.post('/whatsapp/send-single', {
            phone: contact.phone,
            message: message
        });
        
        return {
            name: contact.name,
            phone: contact.phone,
            success: response.success,
            message: response.success ? 'Enviado correctamente' : response.message,
            attempts: 1
        };
        
    } catch (xhr) {
        let errorMessage = 'Error de conexión';
        try {
            const response = JSON.parse(xhr.responseText);
            errorMessage = response.message || errorMessage;
        } catch (e) {
            // Mantener mensaje por defecto
        }
        
        return {
            name: contact.name,
            phone: contact.phone,
            success: false,
            message: errorMessage,
            attempts: 1
        };
    }
}

// ============================
// ACTUALIZACIONES DE PROGRESO
// ============================

function updateProgress() {
    const percentage = loadedContacts.length > 0 ? (processedMessages / loadedContacts.length) * 100 : 0;
    $('.progress-bar-advanced').css('width', percentage + '%').text(Math.round(percentage) + '%');
    $('#overallProgress').text(`${processedMessages} / ${loadedContacts.length}`);
    
    // Actualizar el texto de progreso de lote
    $('#batchProgress').html(`<small class="text-muted">Procesando lote ${currentBatch} de ${totalBatches}...</small>`);
    
    // Actualizar tiempo transcurrido
    if (startTime) {
        const elapsed = new Date() - startTime;
        $('#elapsedTime').text(formatTime(elapsed));
        
        // Calcular tiempo estimado restante
        if (processedMessages > 0) {
            const avgTimePerMessage = elapsed / processedMessages;
            const remainingMessages = loadedContacts.length - processedMessages;
            const estimatedRemaining = remainingMessages * avgTimePerMessage;
            $('#estimatedTimeRemaining').text(formatTime(estimatedRemaining));
        }
    }
}

function updateCurrentBatchInfo(currentBatch, totalBatches, currentInBatch, totalInBatch) {
    $('#currentBatchNumber').text(currentBatch);
    $('#totalBatchNumber').text(totalBatches);
    $('#batchProgressText').text(`${currentInBatch}/${totalInBatch}`);
    $('#currentBatchInfo').show();
}

function updateRealTimeStats() {
    $('#liveSent').text(successfulMessages);
    $('#liveFailed').text(failedMessages);
    $('#currentBatch').text(currentBatch);
    $('#totalBatches').text(totalBatches);
    
    // Actualizar barra de progreso en stats
    const percentage = loadedContacts.length > 0 ? (processedMessages / loadedContacts.length) * 100 : 0;
    $('#liveProgressBar').css('width', percentage + '%');
    
    // Calcular velocidad
    if (startTime && processedMessages > 0) {
        const elapsed = (new Date() - startTime) / 1000;
        const messagesPerSecond = processedMessages / elapsed;
        const messagesPerMinute = messagesPerSecond * 60;
        
        let speedClass = 'speed-slow';
        let speedText = 'Lento';
        
        if (messagesPerMinute > 25) {
            speedClass = 'speed-fast';
            speedText = 'Rápido';
        } else if (messagesPerMinute > 15) {
            speedClass = 'speed-medium';
            speedText = 'Medio';
        }
        
        $('#liveSpeed').html(`<span class="speed-indicator ${speedClass}"></span>${speedText} (${messagesPerMinute.toFixed(1)}/min)`);
        
        // Calcular ETA
        if (processedMessages < loadedContacts.length) {
            const remainingMessages = loadedContacts.length - processedMessages;
            const etaSeconds = remainingMessages / messagesPerSecond;
            $('#liveETA').text(formatTime(etaSeconds * 1000));
        } else {
            $('#liveETA').text('Completado');
        }
    }
}

// ============================
// CONTROLES DE PROCESO
// ============================

function initializeProcessControls() {
    $('#pauseBtn').click(function() {
        isPaused = true;
        $(this).hide();
        $('#resumeBtn').show();
        
        Swal.fire({
            icon: 'info',
            title: 'Envío Pausado',
            text: 'El envío ha sido pausado. Puedes reanudarlo cuando quieras.',
            timer: 2000,
            showConfirmButton: false,
            position: 'top-end',
            toast: true
        });
    });

    $('#resumeBtn').click(function() {
        isPaused = false;
        $(this).hide();
        $('#pauseBtn').show();
        
        Swal.fire({
            icon: 'success',
            title: 'Envío Reanudado',
            text: 'El envío continúa normalmente.',
            timer: 2000,
            showConfirmButton: false,
            position: 'top-end',
            toast: true
        });
    });

    $('#stopBtn').click(function() {
        Swal.fire({
            icon: 'warning',
            title: '¿Detener Envío?',
            text: '¿Estás seguro de que quieres detener el envío? Los mensajes ya enviados no se pueden deshacer.',
            showCancelButton: true,
            confirmButtonText: 'Sí, Detener',
            cancelButtonText: 'Continuar',
            confirmButtonColor: '#dc3545'
        }).then((result) => {
            if (result.isConfirmed) {
                shouldStop = true;
                isPaused = false;
            }
        });
    });
}

function showProcessingControls() {
    $('#sendBulkBtn').hide();
    $('#pauseBtn, #stopBtn').show();
}

function hideProcessingControls() {
    $('#sendBulkBtn').show();
    $('#pauseBtn, #resumeBtn, #stopBtn').hide();
}

// ============================
// FINALIZACIÓN Y RESULTADOS
// ============================

function finalizeBulkSending() {
    isProcessing = false;
    hideProcessingControls();
    updateBulkButton();
    
    $('#advancedProgress').slideUp();
    $('#detailedResultsContainer').slideDown();
    
    // Actualizar estadísticas finales
    $('#finalTotalSent').text(successfulMessages);
    $('#finalTotalFailed').text(failedMessages);
    
    const successRate = loadedContacts.length > 0 ? ((successfulMessages / loadedContacts.length) * 100).toFixed(1) : 0;
    $('#successRate').text(successRate + '%');
    
    if (startTime) {
        const totalTime = new Date() - startTime;
        $('#totalDuration').text(formatTime(totalTime));
    }
    
    displayDetailedResults();
    
    // Alerta final
    if (shouldStop) {
        Swal.fire({
            icon: 'warning',
            title: 'Envío Detenido',
            html: `
                <div class="text-center">
                    <p>Proceso detenido por el usuario.</p>
                    <div class="row">
                        <div class="col-4">
                            <div class="text-success">
                                <strong>${successfulMessages}</strong><br>
                                <small>Enviados</small>
                            </div>
                        </div>
                        <div class="col-4">
                            <div class="text-danger">
                                <strong>${failedMessages}</strong><br>
                                <small>Fallidos</small>
                            </div>
                        </div>
                        <div class="col-4">
                            <div class="text-info">
                                <strong>${processedMessages}</strong><br>
                                <small>Procesados</small>
                            </div>
                        </div>
                    </div>
                </div>
            `,
            confirmButtonText: 'Entendido'
        });
    } else if (successfulMessages === loadedContacts.length) {
        Swal.fire({
            icon: 'success',
            title: '¡Envío Completado con Éxito!',
            html: `
                <div class="text-center">
                    <div class="mb-3">
                        <i class="fas fa-check-circle fa-4x text-success"></i>
                    </div>
                    <p>Se enviaron <strong>${successfulMessages}</strong> mensajes exitosamente</p>
                    <p><small>Tasa de éxito: ${successRate}%</small></p>
                </div>
            `,
            confirmButtonText: 'Excelente'
        });
    } else {
        Swal.fire({
            icon: failedMessages > successfulMessages ? 'error' : 'warning',
            title: 'Envío Finalizado',
            html: `
                <div class="text-center">
                    <div class="row mb-3">
                        <div class="col-6">
                            <div class="text-success">
                                <i class="fas fa-check-circle fa-2x"></i>
                                <div><strong>${successfulMessages}</strong></div>
                                <div><small>Enviados</small></div>
                            </div>
                        </div>
                        <div class="col-6">
                            <div class="text-danger">
                                <i class="fas fa-times-circle fa-2x"></i>
                                <div><strong>${failedMessages}</strong></div>
                                <div><small>Fallidos</small></div>
                            </div>
                        </div>
                    </div>
                    <p><strong>Tasa de éxito:</strong> ${successRate}%</p>
                </div>
            `,
            confirmButtonText: 'Ver Detalles'
        });
    }
    
    // Restablecer estado de conexión
    checkConnectionStatus();
}

function displayDetailedResults() {
    let html = '';
    
    allResults.forEach(function(result, index) {
        const className = result.success ? 'result-success' : 'result-error';
        const icon = result.success ? 'fas fa-check' : 'fas fa-times';
        const attemptsText = result.attempts > 1 ? ` (${result.attempts} intentos)` : '';
        
        html += `
            <div class="result-item ${className}" data-success="${result.success}">
                <div class="d-flex justify-content-between align-items-center">
                    <div>
                        <i class="${icon} me-2"></i>
                        <strong>${result.name}</strong> 
                        <span class="text-muted">(${result.phone})</span>
                    </div>
                    <div class="text-end">
                        <span class="badge ${result.success ? 'bg-success' : 'bg-danger'}">
                            ${result.message}${attemptsText}
                        </span>
                    </div>
                </div>
            </div>
        `;
    });
    
    $('#detailedResults').html(html);
    
    // Event listeners para filtros
    $('input[name="resultFilter"]').change(function() {
        const filter = $(this).attr('id');
        const results = $('#detailedResults .result-item');
        
        results.show();
        
        if (filter === 'filterSuccess') {
            results.filter('[data-success="false"]').hide();
        } else if (filter === 'filterFailed') {
            results.filter('[data-success="true"]').hide();
        }
    });
}

// ============================
// FUNCIONES DE UTILIDAD
// ============================

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function formatTime(milliseconds) {
    const totalSeconds = Math.floor(milliseconds / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    
    if (hours > 0) {
        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    } else {
        return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
}

// ============================
// STATS EN TIEMPO REAL
// ============================

function showRealTimeStats() {
    $('#realTimeStats').slideDown();
}

function hideRealTimeStats() {
    $('#realTimeStats').slideUp();
}

// ============================
// DESCARGAS
// ============================

function downloadSuccessfulContacts() {
    const successfulContacts = allResults.filter(r => r.success);
    downloadCSV(successfulContacts, 'contactos_exitosos.csv');
}

function downloadFailedContacts() {
    const failedContacts = allResults.filter(r => !r.success);
    downloadCSV(failedContacts, 'contactos_fallidos.csv');
}

function downloadCSV(data, filename) {
    if (data.length === 0) {
        Swal.fire({
            icon: 'info',
            title: 'Sin Datos',
            text: 'No hay datos para descargar en esta categoría.',
            confirmButtonText: 'Entendido'
        });
        return;
    }

    const csvContent = "data:text/csv;charset=utf-8," 
        + "Nombre,Teléfono,Estado,Mensaje,Intentos\n"
        + data.map(row => [
            `"${row.name}"`,
            row.phone,
            row.success ? 'Exitoso' : 'Fallido',
            `"${row.message}"`,
            row.attempts || 1
        ].join(",")).join("\n");

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    Swal.fire({
        icon: 'success',
        title: 'Descarga Iniciada',
        text: `El archivo ${filename} se está descargando.`,
        timer: 2000,
        showConfirmButton: false,
        position: 'top-end',
        toast: true
    });
}

// ============================
// INICIALIZACIÓN PRINCIPAL
// ============================

$(document).ready(function() {
    // Inicializar todos los módulos
    initializeSingleMessage();
    initializeExcelUpload();
    initializeBulkSending();
    initializeProcessControls();
    
    // Event listeners para configuración
    $('#batchSize, #delayBetweenMessages, #delayBetweenBatches').change(function() {
        calculateBatches();
    });
    
    $('#messageTemplate').on('input', function() {
        updateBulkButton();
        const length = $(this).val().length;
        $('#templateCharCount').text(`${length} caracteres`);
    });
    
    // Verificar conexión inicial
    checkConnectionStatus();
    setInterval(checkConnectionStatus, CONFIG.connectionCheckInterval);
    
    // Estado inicial
    updateBulkButton();
    updateCharCount();
    
    // Mensaje de bienvenida
    setTimeout(function() {
        Swal.fire({
            icon: 'info',
            title: 'Sistema WhatsApp Masivo',
            html: `
                <div class="text-center">
                    <i class="fab fa-whatsapp fa-3x text-success mb-3"></i>
                    <p>Sistema optimizado para envío de hasta <strong>10,000 mensajes</strong></p>
                    <p><small>Con procesamiento por lotes inteligente y recuperación automática de errores</small></p>
                </div>
            `,
            timer: 4000,
            showConfirmButton: false,
            position: 'top-end',
            toast: true
        });
    }, 1000);
});

// ============================
// FUNCIONES GLOBALES
// ============================

// Hacer funciones disponibles globalmente para onclick handlers
window.showRealTimeStats = showRealTimeStats;
window.hideRealTimeStats = hideRealTimeStats;
window.downloadSuccessfulContacts = downloadSuccessfulContacts;
window.downloadFailedContacts = downloadFailedContacts;