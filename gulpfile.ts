import * as fs from 'fs';
import * as stream from 'stream';
import * as path from 'path';
import * as url from 'url';
import * as del from 'del';
import * as gulp from 'gulp';
import * as gutil from 'gulp-util';
import * as rename from 'gulp-rename';
import * as cheerio from 'cheerio';

const connect = require('gulp-connect');


// Tasks
// =======================================================
gulp.task('default', ['dev']);

gulp.task('dev', ['build', 'watch', 'connect']);

gulp.task('build', ['html']);

gulp.task('html', function () {
    return gulp.src(['index.html'])
        .pipe(rename((path) => path.extname = '-inline.html'))
        .pipe(new InlineScripts())
        .pipe(new InlineStyles())
        .pipe(gulp.dest('dist'))
        .pipe(connect.reload());
});

gulp.task('connect', function () {
    connect.server({
        livereload: true,
        root: 'dist'
    });
});

gulp.task('watch', function () {
    gulp.watch(['index.html'], ['build']);
});

gulp.task('clean', function () {
    return Promise.all([del('dist')]);
});


// Custom Transforms
// =======================================================

const map = (array, callback) => Array.prototype.map.call(array, callback);

function readFile(path: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
        fs.readFile(path, 'utf8', (err, data) => {
            if (err) {
                reject(err);
            }
            else {
                resolve(data);
            }
        });
    });
}

function writeFile(filename: string, contents: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        fs.writeFile(filename, contents, (err) => {
            if (err) {
                reject(err);
            }
            else {
                resolve();
            }
        })
    })
}


abstract class HtmlTransform extends stream.Transform {
    
    abstract pluginName: string;
    
    constructor() {
        super({ objectMode: true })
    }

    abstract transformHtml(file: any): Promise<string>;

    _transform(file, encoding, callback) {
        if (file.isNull()) {
            return callback(null, file);
        }

        if (file.isStream()) {
            this.emit('error', new gutil.PluginError(this.pluginName, 'Streams not supported!'));
        }
        else if (file.isBuffer()) {
            this.transformHtml(file)
                .then(newHtml => {
                    file.contents = new Buffer(newHtml, 'utf8');
                    callback(null, file) 
                })
                .catch(reason => { 
                    let error = new gutil.PluginError(this.pluginName, reason, {showStack: true});
                    console.error(error.toString());
                    callback(error);
                });
        }
    }
}


class InlineScripts extends HtmlTransform {
    public pluginName = 'InlineScripts';

    transformHtml(file: any): Promise<string> {
        // Parse html
        let $ = cheerio.load(file.contents)

        // for each <script> tag with a relative url in the current file
        let scripts = $('script[src]').filter((index, element) => url.parse(element.attribs['src']).protocol == null)
        
        return Promise.all(map(scripts, (element) => {
            let $element = $(element);
            let srcPath = path.join(path.dirname(file.relative), $element.attr('src'));

            // read contents of file at src attr relative to 'dist'
            return readFile(srcPath).then(contents => {
                // remove sourcemap line
                contents = contents.replace(/\s*\/\/# sourceMappingURL=.*/g, '');
                // place contents of file into contents of <script> tag
                $element.text(contents);
                // remove src attr
                $element.removeAttr('src')
                // put original source as data url
                $element.attr('data-src', srcPath);
            });
        }))
        .then(() => $.html());
    }
}


class InlineStyles extends HtmlTransform {
    public pluginName = 'InlineStyles';
    
    transformHtml(file: any): Promise<string> {
        // Parse html
        let $ = cheerio.load(file.contents);

        // for each <link> tag with a relative url
        let styles = $('link[rel=stylesheet][href]').filter((index, element) => url.parse(element.attribs['href']).protocol == null)
        
        return Promise.all(map(styles, (element) => {
            let $element = $(element);
            let srcPath = path.join(path.dirname(file.relative), $element.attr('href'));

            // read contents of file at href attr relative to 'dist'
            return readFile(srcPath).then(contents => {
                // remove sourcemap line
                contents = contents.replace(/\s*\/\/# sourceMappingURL=.*/g, '');

                // create <style> tag with contents of file
                let styleTag = $('<style>')
                    .attr('data-href', $element.attr('href'))
                    .attr('type', 'text/css')
                    .text(contents);

                // replace <link> tag with <style> tag
                $element.replaceWith(styleTag);
            });
        }))
        .then(() => $.html());
    }
}
