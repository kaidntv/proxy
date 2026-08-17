# استخدام نسخة Apache مع PHP
FROM php:8.2-apache

# تحديد المجلد الرئيسي للموقع
WORKDIR /var/www/html

# نسخ ملفاتك من GitHub إلى الخادم
COPY . /var/www/html

# السماح بالوصول للمنفذ 80 (الافتراضي)
EXPOSE 80
