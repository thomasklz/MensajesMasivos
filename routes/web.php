<?php

use Illuminate\Support\Facades\Route;
 use App\Http\Controllers\WhatsAppController;



// Ruta principal - Dashboard WhatsApp
Route::get('/', [WhatsAppController::class, 'index'])->name('whatsapp.index');

// API Routes para WhatsApp
Route::prefix('whatsapp')->group(function () {
    // Verificar estado de conexión WhatsApp
    Route::get('/status', [WhatsAppController::class, 'checkStatus'])->name('whatsapp.status');
    
    // Envío de mensaje individual
    Route::post('/send-single', [WhatsAppController::class, 'sendSingleMessage'])->name('whatsapp.send-single');
    
    // Subir y procesar archivo Excel
    Route::post('/upload-excel', [WhatsAppController::class, 'uploadExcel'])->name('whatsapp.upload-excel');
    
    // Envío masivo optimizado
    Route::post('/send-bulk', [WhatsAppController::class, 'sendBulkMessages'])->name('whatsapp.send-bulk');
});

// Rutas adicionales opcionales para funcionalidades extra
Route::prefix('whatsapp')->middleware(['throttle:60,1'])->group(function () {
    // Descargar plantillas de ejemplo
    Route::get('/download-template', [WhatsAppController::class, 'downloadTemplate'])->name('whatsapp.download-template');
    
    // Obtener estadísticas de envíos
    Route::get('/statistics', [WhatsAppController::class, 'getStatistics'])->name('whatsapp.statistics');
    
    // Limpiar archivos temporales (opcional)
    Route::post('/cleanup', [WhatsAppController::class, 'cleanup'])->name('whatsapp.cleanup');

});