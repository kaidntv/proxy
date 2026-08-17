FROM php:apache
WORKDIR /var/www/html
COPY . /var/www/html
ENV PORT=8000
EXPOSE ${PORT}
RUN sed -i 's/Listen 80/Listen ${PORT}/' /etc/apache2/ports.conf

