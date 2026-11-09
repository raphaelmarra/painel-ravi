#!/system/bin/sh
# Enxuga o Android para servidor. Reversivel: pm enable <pacote>.
PKGS="com.android.messaging com.android.dialer com.android.calculator2 com.android.deskclock com.android.musicfx
com.android.dreams.basic com.android.dreams.phototable com.google.android.apps.googlecamera.fishfood
com.android.hotwordenrollment.okgoogle com.android.hotwordenrollment.xgoogle com.stevesoltys.seedvault
org.calyxos.backup.contacts org.lineageos.glimpse org.lineageos.camelot org.lineageos.backgrounds org.lineageos.aperture
org.lineageos.jelly org.lineageos.recorder org.lineageos.eleven org.lineageos.etar com.android.gallery3d com.android.contacts com.android.calendar com.android.email
com.android.cameraextensions com.android.apps.tag com.android.printspooler com.android.bips com.android.health.connect.backuprestore
com.android.healthconnect.controller com.android.wallpaperbackup com.android.dynsystem com.android.DeviceAsWebcam
com.android.devicediagnostics com.android.traceur com.android.egg org.lineageos.dap com.android.adservices.api
com.android.federatedcompute.services com.android.ondevicepersonalization.services com.android.bookmarkprovider
com.android.musicfx com.android.soundpicker com.android.carrierdefaultapp com.android.simappdialog com.android.stk com.android.imsserviceentitlement"
for p in $PKGS; do pm list packages -a | grep -q "^package:$p$" && pm disable-user --user 0 $p >/dev/null 2>&1 && echo "off $p"; done
pm list packages -d | sed 's/package://' | sort > /data/adb/ravi/disabled-packages.txt
# radios e localizacao
cmd bluetooth_manager disable >/dev/null 2>&1; settings put global bluetooth_on 0
svc nfc disable 2>/dev/null; svc data disable 2>/dev/null
settings put secure location_mode 0
settings put global wifi_scan_always_enabled 0; settings put global ble_scan_always_enabled 0
settings put global mobile_data_always_on 0
# DNS e hora sem Google
settings put global private_dns_mode hostname; settings put global private_dns_specifier dns.quad9.net
settings put global ntp_server pool.ntp.org
settings put global captive_portal_mode 0
# energia: tela apagada, sem animacao
settings put global stay_on_while_plugged_in 0
settings put system screen_off_timeout 15000
settings put system screen_brightness_mode 0; settings put system screen_brightness 1
settings put global window_animation_scale 0; settings put global transition_animation_scale 0; settings put global animator_duration_scale 0
settings put secure screensaver_enabled 0
# bateria: limitar carga (LineageOS charging control)
content insert --uri content://lineagesettings/system --bind name:s:charging_control_enabled --bind value:s:1
content insert --uri content://lineagesettings/system --bind name:s:charging_control_mode --bind value:s:3
content insert --uri content://lineagesettings/system --bind name:s:charging_control_charging_limit --bind value:s:80
input keyevent 223
echo == disabled $(wc -l < /data/adb/ravi/disabled-packages.txt)
