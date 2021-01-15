FROM kennethjiang/octoprint-with-slicers:1.3.6

WORKDIR /app
RUN python setup.py develop

EXPOSE 5000

CMD ["octoprint",  "--iknowwhatimdoing", "--basedir", "/app/data", "--debug"]
